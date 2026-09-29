import argparse
import hashlib
import json
import logging
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import certifi
import psycopg


DIRECTORY = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--read-only", action="store_true")
    parser.add_argument("--confirm-synthetic", action="store_true")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--subscription-id", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--server-name", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument(
        "--azure-cli",
        default=shutil.which("az") or shutil.which("az.cmd"),
    )
    arguments = parser.parse_args()
    if not arguments.azure_cli:
        parser.error("Azure CLI is not on PATH; specify --azure-cli")
    if not arguments.read_only and not arguments.confirm_synthetic:
        parser.error("Writing the demo schema and seed requires --confirm-synthetic")
    TENANT_ID = arguments.tenant_id
    SUBSCRIPTION_ID = arguments.subscription_id
    RESOURCE_GROUP = arguments.resource_group
    SERVER_NAME = arguments.server_name
    DATABASE = arguments.database
    output = DIRECTORY.parents[2] / "artifacts/commerce"
    output.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=output / "seed-azure.log", level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8",
    )
    logging.info("Starting database deployment; read_only=%s", arguments.read_only)

    def azure_json(*command: str):
        result = subprocess.run(
            [arguments.azure_cli, *command, "--only-show-errors", "--output", "json"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        return json.loads(result.stdout)

    account = azure_json("account", "show", "--subscription", SUBSCRIPTION_ID)
    if account["tenantId"] != TENANT_ID or account["id"] != SUBSCRIPTION_ID:
        raise RuntimeError("Unexpected Azure tenant or subscription")
    server = azure_json(
        "postgres", "flexible-server", "show", "--subscription", SUBSCRIPTION_ID,
        "--resource-group", RESOURCE_GROUP, "--name", SERVER_NAME,
    )
    if server["state"] != "Ready" or server["authConfig"]["tenantId"] != TENANT_ID:
        raise RuntimeError("Server is not ready in the expected tenant")
    logging.info("Azure server and tenant confirmed")
    admin = azure_json("ad", "signed-in-user", "show")
    catalogue_path = DIRECTORY.parent / "data" / "catalogue.json"
    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    token = azure_json(
        "account", "get-access-token", "--subscription", SUBSCRIPTION_ID,
        "--resource-type", "oss-rdbms",
    )
    if token["tenant"] != TENANT_ID:
        raise RuntimeError("Unexpected database token tenant")

    try:
        connection = psycopg.connect(
            host=server["fullyQualifiedDomainName"], port=5432, dbname=DATABASE,
            user=admin["userPrincipalName"], password=token["accessToken"],
            sslmode="verify-full", sslrootcert=certifi.where(),
            connect_timeout=30, client_encoding="UTF8", autocommit=True,
            application_name="maikuro-initial-deployment",
            options="-c statement_timeout=60000 -c lock_timeout=10000",
        )
    finally:
        token.clear()

    with connection:
        logging.info("Connected with TLS certificate verification")
        if not arguments.read_only:
            for filename in ("001-schema.sql", "002-seed.sql"):
                connection.execute((DIRECTORY / filename).read_text(encoding="utf-8"))
                logging.info("Applied %s", filename)
                print(f"Applied {filename}", flush=True)

        products = [record[0] for record in connection.execute(
            "SELECT product FROM maikuro.ec_catalogue ORDER BY display_order"
        )]
        stores = [record[0] for record in connection.execute('''
            SELECT row_to_json(store) FROM (
                SELECT store_id AS id, name, city,
                       cold_equipment AS "coldEquipment", cups_per_day AS "cupsPerDay"
                FROM maikuro.stores ORDER BY store_id
            ) AS store
        ''')]
        suppliers = [record[0] for record in connection.execute('''
            SELECT row_to_json(supplier) FROM (
                SELECT supplier_id AS id, name, city FROM maikuro.suppliers ORDER BY supplier_id
            ) AS supplier
        ''')]
        supplier_links = dict(connection.execute(
            "SELECT product_id, supplier_id FROM maikuro.products"
        ).fetchall())
        matches = {
            "products": products == catalogue["products"],
            "stores": stores == sorted(catalogue["stores"], key=lambda store: store["id"]),
            "suppliers": suppliers == sorted(catalogue["suppliers"], key=lambda supplier: supplier["id"]),
            "supplierLinks": supplier_links == {
                link["productId"]: link["supplierId"] for link in catalogue["productLinks"]
            },
        }
        if not all(matches.values()):
            raise RuntimeError(f"Database readback differs from catalogue: {matches}")
        tls = connection.execute(
            "SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
        ).fetchone()

    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "tenantId": TENANT_ID, "subscriptionId": SUBSCRIPTION_ID,
        "resourceGroup": RESOURCE_GROUP, "serverName": SERVER_NAME,
        "resourceId": server["id"], "host": server["fullyQualifiedDomainName"],
        "database": DATABASE, "region": server["location"], "sku": server["sku"],
        "storage": server["storage"], "postgresVersion": server["version"],
        "authentication": server["authConfig"], "backup": server["backup"],
        "highAvailability": server["highAvailability"],
        "administrator": admin["userPrincipalName"],
        "counts": {"products": len(products), "stores": len(stores), "suppliers": len(suppliers)},
        "catalogueMatches": matches, "tls": tls[0] if tls else None,
        "sslmode": "verify-full", "dataOrigin": "synthetic",
        "catalogueSha256": hashlib.sha256(catalogue_path.read_bytes()).hexdigest(),
        "sqlSha256": {
            filename: hashlib.sha256((DIRECTORY / filename).read_bytes()).hexdigest()
            for filename in ("001-schema.sql", "002-seed.sql")
        },
        "frontendUsesDatabase": False, "fabricSynchronization": False,
    }
    serialized = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    (output / "deployment.json").write_text(serialized, encoding="utf-8")
    logging.info("All catalogue records match; deployment.json written")
    print(serialized)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Database deployment did not complete")
        raise