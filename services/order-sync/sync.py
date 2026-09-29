import argparse
import json
import os
import re
import struct
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener

import certifi
import psycopg
import pyodbc
from azure.identity import AzureCliCredential
from dotenv import dotenv_values
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POSTGRES_ENV = ROOT / 'apps/storefront/.env'
REPORTS = ROOT / 'artifacts/order-sync'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def arguments():
    parser = argparse.ArgumentParser(description='PostgreSQL の EC 受注を Rayfin 管理 SQL へ同期します。')
    parser.add_argument('--postgres-env', type=Path, default=DEFAULT_POSTGRES_ENV)
    parser.add_argument('--tenant-id', required=True, type=uuid.UUID)
    parser.add_argument('--workspace-id', required=True, type=uuid.UUID)
    parser.add_argument('--sql-database-id', required=True, type=uuid.UUID)
    parser.add_argument('--batch-size', type=int, default=100)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only', action='store_true')
    mode.add_argument('--apply', action='store_true')
    return parser.parse_args()


def postgres_settings(path):
    file_values = dotenv_values(path) if path.is_file() else {}

    def value(name, default=None):
        return os.environ.get(name) or file_values.get(name) or default

    settings = {
        'host': value('PGHOST'),
        'port': int(value('PGPORT', '5432')),
        'dbname': value('PGDATABASE'),
        'user': value('PGUSER'),
    }
    if not all(settings.values()):
        raise RuntimeError('PostgreSQL の PGHOST、PGPORT、PGDATABASE、PGUSER を設定してください。')
    return settings


def fabric_connection(workspace_id, database_id, credential):
    token = credential.get_token('https://api.fabric.microsoft.com/.default').token
    request = Request(f'https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/sqlDatabases/{database_id}',
                      headers={'Authorization': f'Bearer {token}'})
    with build_opener(NoRedirect()).open(request, timeout=60) as response:
        item = json.load(response)
    if item['id'].lower() != database_id or item['workspaceId'].lower() != workspace_id:
        raise RuntimeError('Rayfin SQL の配備先が想定と一致しません。')
    server = item['properties']['serverFqdn']
    database_name = item['properties']['databaseName']
    if not re.fullmatch(r'[a-zA-Z0-9-]+\.database\.fabric\.microsoft\.com(?:,1433)?', server):
        raise RuntimeError('Rayfin SQL のサーバー名を確認してください。')
    driver = next((name for name in ('ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server')
                   if name in pyodbc.drivers()), None)
    if not driver:
        raise RuntimeError('Microsoft ODBC Driver 18 for SQL Server が必要です。')
    token = credential.get_token('https://database.windows.net/.default').token.encode('utf-16-le')
    return pyodbc.connect(
        f'DRIVER={{{driver}}};SERVER={server};DATABASE={database_name};Encrypt=yes;TrustServerCertificate=no;',
        attrs_before={1256: struct.pack('<I', len(token)) + token}, timeout=30, autocommit=False)


def assert_rayfin_schema(cursor):
    cursor.execute("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo'")
    columns = {}
    for table_name, column_name in cursor.fetchall():
        columns.setdefault(table_name, set()).add(column_name)
    expected = {
        'EcOrders': {'id', 'businessId', 'sourceOrderId', 'customerId', 'storeId', 'orderedAt', 'pickupAt', 'fulfilledAt', 'status'},
        'EcOrderLines': {'id', 'businessId', 'orderId', 'productId', 'quantity', 'priceExTax', 'taxPercent', 'discountExTax'},
        'EcProducts': {'id', 'businessId', 'name', 'category', 'serving', 'priceExTax', 'taxPercent', 'supplierId'},
        'EcCustomers': {'id', 'businessId', 'displayName', 'loyaltyTier', 'source'},
    }
    for table, fields in expected.items():
        if not fields.issubset(columns.get(table, set())):
            raise RuntimeError(f'Rayfin SQL の {table} が未配備または列不足です。先に rayfin up を実行してください。')


def required_object(value, name):
    if not isinstance(value, dict):
        raise RuntimeError(f'outbox の {name} がオブジェクトではありません。')
    return value


def required_text(value, name):
    if not isinstance(value, str) or not value:
        raise RuntimeError(f'outbox の {name} が不正です。')
    return value


def sync_order(cursor, event, namespace):
    payload = required_object(event['payload'], 'payload')
    if payload.get('eventType') != event['event_type']:
        raise RuntimeError('outbox のイベント種別が一致しません。')
    order = required_object(payload.get('order'), 'order')
    business_id = required_text(order.get('id'), 'order.id')
    source_order_id = required_text(order.get('sourceOrderId'), 'order.sourceOrderId')
    status = required_text(order.get('status'), 'order.status')
    if status not in {'confirmed', 'received', 'cancelled'}:
        raise RuntimeError('outbox の注文状態が不正です。')
    order_id = str(uuid.uuid5(namespace, f'EcOrder/{source_order_id}'))
    values = {
        'id': order_id,
        'businessId': business_id,
        'sourceOrderId': source_order_id,
        'customerId': required_text(order.get('customerId'), 'order.customerId'),
        'storeId': required_text(order.get('storeId'), 'order.storeId'),
        'orderedAt': required_text(order.get('orderedAt'), 'order.orderedAt'),
        'pickupAt': required_text(order.get('pickupAt'), 'order.pickupAt'),
        'fulfilledAt': order.get('fulfilledAt') or None,
        'status': status,
    }
    cursor.execute('SELECT businessId FROM dbo.EcCustomers WITH (UPDLOCK,HOLDLOCK) WHERE businessId = ?', values['customerId'])
    if not cursor.fetchone():
        cursor.execute('INSERT INTO dbo.EcCustomers (id, businessId, displayName, loyaltyTier, source) VALUES (?, ?, ?, ?, ?)',
                       str(uuid.uuid5(namespace, f'EcCustomer/{values["customerId"]}')), values['customerId'],
                       'EC ゲスト', 'ゲスト', 'EcOrders.customerId')
    cursor.execute('SELECT id, sourceOrderId, customerId, storeId, orderedAt, fulfilledAt, status FROM dbo.EcOrders WITH (UPDLOCK,HOLDLOCK) WHERE businessId = ?', business_id)
    existing = cursor.fetchone()
    if existing:
        immutable = [str(existing.id).lower(), existing.sourceOrderId, existing.customerId, existing.storeId, existing.orderedAt]
        expected = [order_id, values['sourceOrderId'], values['customerId'], values['storeId'], values['orderedAt']]
        if immutable != expected:
            raise RuntimeError(f'Rayfin SQL の既存注文が PostgreSQL と一致しません: {business_id}')
        fulfilled_at = values['fulfilledAt']
        if existing.status in {'received', 'cancelled'} and status == 'confirmed':
            status = existing.status
            fulfilled_at = existing.fulfilledAt
        elif existing.status in {'received', 'cancelled'} and status != existing.status:
            raise RuntimeError(f'Rayfin SQL の注文状態を変更できません: {business_id}')
        cursor.execute('UPDATE dbo.EcOrders SET pickupAt = ?, fulfilledAt = ?, status = ? WHERE businessId = ?',
                       values['pickupAt'], fulfilled_at, status, business_id)
    else:
        fields = list(values)
        cursor.execute(
            f"INSERT INTO dbo.EcOrders ({', '.join(f'[{field}]' for field in fields)}) VALUES ({', '.join('?' for _ in fields)})",
            [values[field] for field in fields])

    products = payload.get('products')
    if not isinstance(products, list) or not products:
        raise RuntimeError('outbox の products が不正です。')
    for product in products:
        product = required_object(product, 'products[]')
        product_business_id = required_text(product.get('id'), 'products[].id')
        product_values = {
            'id': str(uuid.uuid5(namespace, f'EcProduct/{product_business_id}')),
            'businessId': product_business_id,
            'name': required_text(product.get('name'), 'products[].name'),
            'category': required_text(product.get('category'), 'products[].category'),
            'serving': required_text(product.get('serving'), 'products[].serving'),
            'priceExTax': int(product.get('priceExTax')),
            'taxPercent': float(product.get('taxPercent')),
            'supplierId': product.get('supplierId') or None,
        }
        cursor.execute('SELECT id FROM dbo.EcProducts WITH (UPDLOCK,HOLDLOCK) WHERE businessId = ?', product_business_id)
        existing_product = cursor.fetchone()
        if existing_product:
            if str(existing_product.id).lower() != product_values['id']:
                raise RuntimeError(f'Rayfin SQL の既存商品 ID が一致しません: {product_business_id}')
            cursor.execute(
                '''UPDATE dbo.EcProducts
                   SET name = ?, category = ?, serving = ?, priceExTax = ?, taxPercent = ?, supplierId = ?
                   WHERE businessId = ?''',
                product_values['name'], product_values['category'], product_values['serving'],
                product_values['priceExTax'], product_values['taxPercent'], product_values['supplierId'],
                product_business_id)
        else:
            fields = list(product_values)
            cursor.execute(
                f"INSERT INTO dbo.EcProducts ({', '.join(f'[{field}]' for field in fields)}) VALUES ({', '.join('?' for _ in fields)})",
                [product_values[field] for field in fields])

    order_lines = payload.get('orderLines')
    if not isinstance(order_lines, list) or not order_lines:
        raise RuntimeError('outbox の orderLines が不正です。')
    for line in order_lines:
        line = required_object(line, 'orderLines[]')
        line_business_id = required_text(line.get('id'), 'orderLines[].id')
        line_values = {
            'id': str(uuid.uuid5(namespace, f'EcOrderLine/{line_business_id}')),
            'businessId': line_business_id,
            'orderId': business_id,
            'productId': required_text(line.get('productId'), 'orderLines[].productId'),
            'quantity': int(line.get('quantity')),
            'priceExTax': int(line.get('priceExTax')),
            'taxPercent': float(line.get('taxPercent')),
            'discountExTax': int(line.get('discountExTax')),
        }
        cursor.execute('SELECT id, orderId, productId, quantity, priceExTax, taxPercent, discountExTax FROM dbo.EcOrderLines WITH (UPDLOCK,HOLDLOCK) WHERE businessId = ?', line_business_id)
        existing_line = cursor.fetchone()
        if existing_line:
            actual = [str(existing_line.id).lower(), existing_line.orderId, existing_line.productId,
                      existing_line.quantity, existing_line.priceExTax, float(existing_line.taxPercent), existing_line.discountExTax]
            expected = [line_values[field] for field in ('id', 'orderId', 'productId', 'quantity', 'priceExTax', 'taxPercent', 'discountExTax')]
            if actual != expected:
                raise RuntimeError(f'Rayfin SQL の既存注文明細が PostgreSQL と一致しません: {line_business_id}')
        else:
            fields = list(line_values)
            cursor.execute(
                f"INSERT INTO dbo.EcOrderLines ({', '.join(f'[{field}]' for field in fields)}) VALUES ({', '.join('?' for _ in fields)})",
                [line_values[field] for field in fields])


def verify_sync(postgres, rayfin):
    with postgres.cursor() as source:
        source.execute('SELECT count(*) AS count FROM maikuro.rayfin_outbox WHERE published_at IS NULL')
        pending_outbox = source.fetchone()['count']
        source.execute('SELECT order_number, status FROM maikuro.orders ORDER BY order_number')
        source_orders = [dict(businessId=row['order_number'], status=row['status']) for row in source.fetchall()]
        source.execute('SELECT count(*) AS count FROM maikuro.order_lines')
        source_lines = source.fetchone()['count']
        source.execute('SELECT count(DISTINCT product_id) AS count FROM maikuro.order_lines')
        source_products = source.fetchone()['count']
    destination = rayfin.cursor()
    assert_rayfin_schema(destination)
    destination.execute('SELECT businessId, status FROM dbo.EcOrders ORDER BY businessId')
    target_orders = [dict(businessId=row.businessId, status=row.status) for row in destination.fetchall()]
    destination.execute('SELECT count(*) FROM dbo.EcOrderLines')
    target_lines = destination.fetchone()[0]
    destination.execute('SELECT count(*) FROM dbo.EcProducts')
    target_products = destination.fetchone()[0]
    return {
        'pendingOutbox': pending_outbox,
        'postgres': {'orders': source_orders, 'orderLines': source_lines, 'orderedProducts': source_products},
        'rayfin': {'orders': target_orders, 'orderLines': target_lines, 'products': target_products},
        'ordersMatch': source_orders == target_orders,
        'lineCountsMatch': source_lines == target_lines,
        'productCountsMatch': source_products == target_products,
    }


def main():
    args = arguments()
    if not 1 <= args.batch_size <= 1000:
        raise RuntimeError('batch-size は 1 から 1000 の範囲で指定してください。')
    database_id = str(args.sql_database_id)
    workspace_id = str(args.workspace_id)
    credential = AzureCliCredential(tenant_id=str(args.tenant_id))
    settings = postgres_settings(args.postgres_env)
    postgres_token = credential.get_token('https://ossrdbms-aad.database.windows.net/.default').token
    postgres = psycopg.connect(**settings, password=postgres_token, sslmode='verify-full', sslrootcert=certifi.where(),
                               connect_timeout=30, row_factory=dict_row)
    try:
        rayfin = fabric_connection(workspace_id, database_id, credential)
    except Exception:
        postgres.close()
        raise
    REPORTS.mkdir(parents=True, exist_ok=True)
    if args.verify_only:
        try:
            report = {
                'workspaceId': workspace_id,
                'sqlDatabaseId': database_id,
                'verifiedAt': datetime.now(timezone.utc).isoformat(),
                **verify_sync(postgres, rayfin),
            }
        finally:
            rayfin.close()
            postgres.close()
        (REPORTS / 'verification.json').write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)
        return
    event_ids = []
    try:
        with postgres.cursor() as source:
            source.execute(
                '''SELECT event_id::text, event_type, payload
                   FROM maikuro.rayfin_outbox
                   WHERE published_at IS NULL
                   ORDER BY occurred_at, event_id
                   LIMIT %s
                   FOR UPDATE SKIP LOCKED''',
                (args.batch_size,))
            events = source.fetchall()
            event_ids = [event['event_id'] for event in events]
            destination = rayfin.cursor()
            destination.execute('SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;')
            assert_rayfin_schema(destination)
            namespace = uuid.UUID(database_id)
            for event in events:
                sync_order(destination, event, namespace)
            rayfin.commit()
            if event_ids:
                source.execute(
                    '''UPDATE maikuro.rayfin_outbox
                       SET published_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL
                       WHERE event_id = ANY(%s::uuid[])''',
                    (event_ids,))
            postgres.commit()
    except Exception as error:
        rayfin.rollback()
        postgres.rollback()
        if event_ids:
            with postgres.cursor() as source:
                source.execute(
                    '''UPDATE maikuro.rayfin_outbox
                       SET attempts = attempts + 1, last_error = %s
                       WHERE event_id = ANY(%s::uuid[])''',
                    (str(error)[:2000], event_ids))
            postgres.commit()
        raise
    finally:
        rayfin.close()
        postgres.close()
    report = {
        'workspaceId': workspace_id,
        'sqlDatabaseId': database_id,
        'processedEvents': len(event_ids),
        'syncedAt': datetime.now(timezone.utc).isoformat(),
    }
    (REPORTS / 'sync.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()