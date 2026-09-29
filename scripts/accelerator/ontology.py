import base64
import hashlib
import json
import math
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5
import pyarrow as pa
import pyarrow.parquet as pq
V3 = 'scenarios/micro-coffee'

ARROW_TYPES = {
    "String": pa.string(), "BigInt": pa.int64(), "Double": pa.float64(),
    "Boolean": pa.bool_(), "DateTime": pa.timestamp("ms", tz="UTC"),
}


LOADER_TYPES = {
    "String": "string", "BigInt": "long", "Double": "double",
    "Boolean": "boolean", "DateTime": "timestamp",
}


def encode(value):
    return base64.b64encode(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).decode()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def numeric_id(logical_name):
    digest = hashlib.sha256(("maikuro-v3/" + logical_name).encode()).digest()
    return str((int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)) or 1)


def guid(logical_name):
    return str(uuid5(NAMESPACE_URL, "urn:maikuro:v3:" + logical_name))


def cast(value, prop):
    if value is None:
        if prop["nullable"]:
            return None
        raise ValueError(f"Required value: {prop['name']}")
    value_type = prop["valueType"]
    valid = {
        "String": isinstance(value, str),
        "BigInt": type(value) is int and abs(value) <= (1 << 53) - 1,
        "Double": type(value) in (int, float) and math.isfinite(value),
        "Boolean": type(value) is bool,
        "DateTime": isinstance(value, str),
    }
    if not valid[value_type]:
        raise ValueError(f"Invalid {value_type}: {prop['name']}")
    if value_type == "DateTime":
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError(f"Timezone required: {prop['name']}")
        return parsed.astimezone(timezone.utc)
    return value


def prepare_model(definition, data):
    if definition["format"] != "micro-coffee-ontology-v1" or data["datasetId"] != definition["datasetId"]:
        raise ValueError("Definition format or dataset mismatch")
    tables = {}
    for table in definition["tables"]:
        table_id = table["id"]
        rows = data[table_id]
        keys = [row[table["key"]] for row in rows]
        if any(not isinstance(key, str) or not key.strip() for key in keys) or len(keys) != len(set(keys)):
            raise ValueError(f"Invalid keys: {table_id}")
        schema = pa.schema([pa.field(prop["sourceColumn"], ARROW_TYPES[prop["valueType"]], nullable=prop["nullable"])
                            for prop in table["properties"]])
        converted = [{prop["sourceColumn"]: cast(row[prop["sourceColumn"]], prop)
                      for prop in table["properties"]} for row in rows]
        tables[table_id] = pa.Table.from_pylist(converted, schema=schema)
    for relation in definition["relations"]:
        if relation["mappingTable"] != relation["source"] or relation["source"] == relation["target"]:
            raise ValueError("This compiler requires the current v3 non-self, source-table relationships")
        for column, table_id in [(relation["sourceColumn"], relation["source"]),
                                 (relation["targetColumn"], relation["target"])]:
            key = next(table["key"] for table in definition["tables"] if table["id"] == table_id)
            target_keys = {row[key] for row in data[table_id]}
            if any(row[column] not in target_keys for row in data[relation["mappingTable"]]):
                raise ValueError(f"Orphan reference: {relation['id']}")
    return tables


def compile_model(definition, data, tables, output, workspace_id, lakehouse_id, graph_helper, display_prefix="MaikuroV3"):
    model_id = definition["modelId"]
    model_path = output / model_id
    display_name = display_prefix + model_id.title()
    bound = workspace_id is not None
    decoded = [{"path": ".platform", "payload": {"metadata": {"type": "Ontology", "displayName": display_name}}},
               {"path": "definition.json", "payload": {}}]
    schema_parts = list(decoded)
    table_manifest = []
    model_index = {"entities": {}, "relationships": {}}
    entities = {}
    bindings = {"relationships": {}}
    definitions = {table["id"]: table for table in definition["tables"]}

    def add(path, payload, schema=False):
        part = {"path": path, "payload": payload}
        decoded.append(part)
        if schema:
            schema_parts.append(part)

    for table in definition["tables"]:
        table_id = table["id"]
        logical = f"{model_id}/{table_id}"
        entity_id = numeric_id(logical)
        table_name = f"mc_v3_{model_id}_{table_id}"
        properties = [{"id": numeric_id(logical + "/" + prop["sourceColumn"]), "name": prop["name"],
                       "valueType": prop["valueType"], "redefines": None, "baseTypeNamespaceType": None,
                       "semanticEnrichment": {"description": prop.get("description", prop["name"]),
                                              "customAttributes": {"nullable": str(prop["nullable"]).lower(),
                                                                   "unit": prop.get("unit", "")}}}
                      for prop in table["properties"]]
        by_column = dict(zip([prop["sourceColumn"] for prop in table["properties"]], properties))
        model_index["entities"][table["entityType"]] = {"entity_id": entity_id, "property_by_column": by_column}
        entities[table["entityType"]] = {"headers": list(by_column), "identifier": table["key"], "table_name": table_name,
                                      "column_type": {prop["sourceColumn"]: (LOADER_TYPES[prop["valueType"]], prop["valueType"])
                                                      for prop in table["properties"]}}
        add(f"EntityTypes/{entity_id}/definition.json", {
            "id": entity_id, "namespace": "usertypes", "baseEntityTypeId": None, "name": table["entityType"],
            "entityIdParts": [by_column[table["key"]]["id"]],
            "displayNamePropertyId": by_column[table["displayColumn"]]["id"],
            "namespaceType": "Custom", "visibility": "Visible", "properties": properties, "timeseriesProperties": [],
            "semanticEnrichment": {"description": table["description"], "customAttributes": {"source": definition["source"]}}}, True)
        parquet_path = model_path / "data" / f"{table_name}.parquet"
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(tables[table_id], parquet_path, compression="snappy", version="1.0", coerce_timestamps="ms")
        remote_path = f"Files/workshops/micro_coffee_v3/{model_id}/{table_name}.parquet"
        table_manifest.append({
            "sourceFile": f"data/{table_name}.parquet", "sourcePath": remote_path,
            "targetSchema": "dbo", "targetTable": table_name, "rows": tables[table_id].num_rows,
            "sha256": hashlib.sha256(parquet_path.read_bytes()).hexdigest(),
            "columns": [{"name": prop["sourceColumn"], "type": LOADER_TYPES[prop["valueType"]], "nullable": prop["nullable"]}
                        for prop in table["properties"]], "primaryKey": [table["key"]],
            "foreignKeys": [{"columns": [relation["targetColumn"]],
                             "referencedTable": f"mc_v3_{model_id}_{relation['target']}",
                             "referencedColumns": [definitions[relation["target"]]["key"]], "allowNull": False}
                            for relation in definition["relations"] if relation["mappingTable"] == table_id],
            "loadRequest": {"relativePath": remote_path, "pathType": "File", "mode": "Overwrite",
                            "recursive": False, "formatOptions": {"format": "Parquet"}}})
        if bound:
            binding_id = guid(logical + "/binding")
            add(f"EntityTypes/{entity_id}/DataBindings/{binding_id}.json", {
                "id": binding_id, "dataBindingConfiguration": {"dataBindingType": "NonTimeSeries",
                    "propertyBindings": [{"sourceColumnName": column, "targetPropertyId": prop["id"]} for column, prop in by_column.items()],
                    "sourceTableProperties": {"sourceType": "LakehouseTable", "workspaceId": workspace_id,
                                              "itemId": lakehouse_id, "sourceTableName": table_name, "sourceSchema": "dbo"}}})

    for relation in definition["relations"]:
        logical = model_id + "/relation/" + relation["id"]
        relation_id = numeric_id(logical)
        name = relation["id"].replace("-", "_")
        source = definitions[relation["source"]]
        target = definitions[relation["target"]]
        source_model = model_index["entities"][source["entityType"]]
        target_model = model_index["entities"][target["entityType"]]
        model_index["relationships"][name] = {"relationship_id": relation_id}
        bindings["relationships"][name] = {"from": source["entityType"], "to": target["entityType"], "toKey": relation["targetColumn"]}
        add(f"RelationshipTypes/{relation_id}/definition.json", {
            "id": relation_id, "namespace": "usertypes", "namespaceType": "Custom", "name": name,
            "source": {"entityTypeId": source_model["entity_id"]}, "target": {"entityTypeId": target_model["entity_id"]},
            "semanticEnrichment": {"description": relation["name"]}}, True)
        if bound:
            context_id = guid(logical + "/context")
            add(f"RelationshipTypes/{relation_id}/Contextualizations/{context_id}.json", {
                "id": context_id, "dataBindingTable": {"sourceType": "LakehouseTable", "workspaceId": workspace_id,
                    "itemId": lakehouse_id, "sourceTableName": f"mc_v3_{model_id}_{relation['mappingTable']}", "sourceSchema": "dbo"},
                "sourceKeyRefBindings": [{"sourceColumnName": relation["sourceColumn"], "targetPropertyId": source_model["property_by_column"][source["key"]]["id"]}],
                "targetKeyRefBindings": [{"sourceColumnName": relation["targetColumn"], "targetPropertyId": target_model["property_by_column"][target["key"]]["id"]}]})

    ids = [part["payload"]["id"] for part in schema_parts if "id" in part["payload"]]
    ids += [prop["id"] for part in schema_parts for prop in part["payload"].get("properties", [])]
    if len(ids) != len(set(ids)):
        raise ValueError("Numeric ID collision")
    api_parts = [{"path": part["path"], "payload": encode(part["payload"]), "payloadType": "InlineBase64"} for part in decoded]
    schema_api = [{"path": part["path"], "payload": encode(part["payload"]), "payloadType": "InlineBase64"} for part in schema_parts]
    save(model_path / "schema-create-request.json", {"displayName": display_name, "type": "Ontology", "definition": {"parts": schema_api}})
    graph = None
    if bound:
        graph_decoded, _ = graph_helper.build_graph_definition(entities, bindings, model_index, workspace_id, lakehouse_id, display_name + "Graph")
        graph_by_path = {part["path"]: part["payload"] for part in graph_decoded}
        sources = graph_by_path["dataSources.json"]
        sources["itemReferences"] = [{"name": "workspaceData", "item": {"workspaceId": workspace_id, "itemId": lakehouse_id}}]
        source_names = {}
        for source in sources["dataSources"]:
            table_name = source["properties"]["path"].rsplit("/", 1)[1]
            source_names[source["name"]] = table_name
            source["name"] = table_name
            source["properties"] = {"referenceName": "workspaceData", "path": "Tables/" + table_name}
        mappings = graph_by_path["graphDefinition.json"]
        for mapping in mappings["nodeTables"] + mappings["edgeTables"]:
            mapping["dataSourceName"] = source_names[mapping["dataSourceName"]]
        for node_type, node_table, table in zip(graph_by_path["graphType.json"]["nodeTypes"], graph_by_path["graphDefinition.json"]["nodeTables"], definition["tables"]):
            names = {prop["sourceColumn"]: prop["name"] for prop in table["properties"]}
            node_type["primaryKeyProperties"] = [names[table["key"]]]
            for prop in node_type["properties"]:
                prop["name"] = names[prop["name"]]
            for mapping in node_table["propertyMappings"]:
                mapping["propertyName"] = names[mapping["sourceColumn"]]
        graph = {"decodedParts": graph_decoded, "definition": {"format": "json", "parts": [
            {"path": part["path"], "payload": encode(part["payload"]), "payloadType": "InlineBase64"} for part in graph_decoded]}}
        save(model_path / "create-request.json", {"displayName": display_name, "type": "Ontology", "definition": {"parts": api_parts}})
        save(model_path / "graph-update-request.json", {"definition": graph["definition"]})
    save(model_path / "fabric.generated.json", {
        "schemaVersion": "1.0", "workshop": {"id": f"micro-coffee-v3-{model_id}", "path": str(V3),
            "contentId": "sha256:" + hashlib.sha256(json.dumps([definition, data], ensure_ascii=False, sort_keys=True).encode()).hexdigest()},
        "target": {"mode": "create" if bound else "plan", "workspaceId": workspace_id, "lakehouseId": lakehouse_id, "ontologyId": None},
        "lakehouse": {"tables": table_manifest},
        "ontology": {"displayName": display_name, "decodedParts": decoded, "definition": {"parts": api_parts}}, "graph": graph,
        "changes": {"create": [table["entityType"] for table in definition["tables"]], "update": [], "delete": [], "typeChange": []},
        "assumptions": ["Create-only. Existing remote IDs are never adopted.", "Classic managed Lakehouse; sourceSchema dbo."],
        "warnings": ["Not deployed. Bound payloads require remote preflight and approval.", "Load requests overwrite their target tables; require ownership and overwrite approval."],
        "exclusions": ["Legacy 40-table model", "EC-only bean SKUs", "Customer voice tables outside the current ontology"],
        "unresolved": [] if bound else ["workspaceId", "lakehouseId"],
        "sourceEvidence": [f"ontology/{model_id}.json", definition["source"], "pyarrow " + pa.__version__]})
