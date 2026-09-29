import base64
import json
from uuid import NAMESPACE_URL, uuid5

GRAPH_DATA_SOURCES_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/graphIndex/"
    "definition/dataSources/1.1.0/schema.json"
)


GRAPH_DEFINITION_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/graphIndex/"
    "definition/graphDefinition/1.0.0/schema.json"
)


GRAPH_TYPE_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/graphIndex/"
    "definition/graphType/1.0.0/schema.json"
)


GRAPH_STYLING_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/graphIndex/"
    "definition/stylingConfiguration/1.0.0/schema.json"
)


class DeployError(RuntimeError):
    pass


def base64_json(value):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(payload).decode("ascii")


def graph_value_type(ontology_value_type):
    value_types = {
        "String": "STRING",
        "BigInt": "INT",
        "Double": "FLOAT",
        "DateTime": "DATETIME",
        "Boolean": "BOOLEAN",
    }
    if ontology_value_type not in value_types:
        raise DeployError(
            f"GraphModel does not support ontology value type '{ontology_value_type}'."
        )
    return value_types[ontology_value_type]


def graph_table_path(workspace_id, lakehouse_id, table_name):
    return (
        f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/"
        f"{lakehouse_id}/Tables/{table_name}"
    )


def build_graph_definition(entities, bindings, model_index, workspace_id, lakehouse_id,
                           graph_name):
    table_names = sorted({entity["table_name"] for entity in entities.values()})
    data_source_names = {
        table_name: f"{lakehouse_id}_{table_name}" for table_name in table_names
    }
    data_sources = [
        {
            "name": data_source_names[table_name],
            "type": "DeltaTable",
            "properties": {"path": graph_table_path(workspace_id, lakehouse_id, table_name)},
        }
        for table_name in table_names
    ]

    node_types = []
    node_tables = []
    positions = {}
    styles = {}
    for index, (entity_name, entity) in enumerate(entities.items()):
        model = model_index["entities"][entity_name]
        alias = model["entity_id"]
        node_types.append({
            "primaryKeyProperties": [entity["identifier"]],
            "alias": alias,
            "labels": [entity_name],
            "properties": [
                {"name": column, "type": graph_value_type(entity["column_type"][column][1])}
                for column in entity["headers"]
            ],
        })
        node_tables.append({
            "nodeTypeAlias": alias,
            "id": str(uuid5(NAMESPACE_URL, f"urn:micro-coffee:graph:{graph_name}:node:{alias}")),
            "dataSourceName": data_source_names[entity["table_name"]],
            "propertyMappings": [
                {"propertyName": column, "sourceColumn": column}
                for column in entity["headers"]
            ],
        })
        positions[alias] = {"x": 100 + (index % 4) * 220, "y": 100 + (index // 4) * 180}
        styles[alias] = {"size": 30}

    edge_types = []
    edge_tables = []
    for relationship_name, relationship in bindings["relationships"].items():
        alias = model_index["relationships"][relationship_name]["relationship_id"]
        source_alias = model_index["entities"][relationship["from"]]["entity_id"]
        target_alias = model_index["entities"][relationship["to"]]["entity_id"]
        source_entity = entities[relationship["from"]]
        edge_types.append({
            "alias": alias,
            "labels": [relationship_name],
            "sourceNodeType": {"alias": source_alias},
            "destinationNodeType": {"alias": target_alias},
            "properties": [],
        })
        edge_tables.append({
            "edgeTypeAlias": alias,
            "id": str(uuid5(NAMESPACE_URL, f"urn:micro-coffee:graph:{graph_name}:edge:{alias}")),
            "dataSourceName": data_source_names[source_entity["table_name"]],
            "sourceNodeKeyColumns": [source_entity["identifier"]],
            "destinationNodeKeyColumns": [relationship["toKey"]],
            "propertyMappings": [],
        })
        styles[alias] = {"size": 30}

    decoded_parts = [
        {"path": "graphType.json", "payload": {
            "$schema": GRAPH_TYPE_SCHEMA, "nodeTypes": node_types, "edgeTypes": edge_types}},
        {"path": "dataSources.json", "payload": {
            "$schema": GRAPH_DATA_SOURCES_SCHEMA, "dataSources": data_sources}},
        {"path": "graphDefinition.json", "payload": {
            "$schema": GRAPH_DEFINITION_SCHEMA,
            "nodeTables": node_tables, "edgeTables": edge_tables}},
        {"path": "stylingConfiguration.json", "payload": {
            "$schema": GRAPH_STYLING_SCHEMA,
            "modelLayout": {"positions": positions, "styles": styles,
                            "pan": {"x": 0.0, "y": 0.0}, "zoomLevel": 1.0},
            "visualFormat": None, "scenario": "Ontology"}},
        {"path": ".platform", "payload": {
            "metadata": {"type": "GraphModel", "displayName": graph_name}}},
    ]
    validate_graph_definition(decoded_parts, len(entities), len(bindings["relationships"]),
                              len(data_sources))
    api_parts = [
        {"path": part["path"], "payload": base64_json(part["payload"]),
         "payloadType": "InlineBase64"}
        for part in decoded_parts
    ]
    return decoded_parts, api_parts


def validate_graph_definition(decoded_parts, entity_count, relationship_count, data_source_count):
    by_path = {part["path"]: part["payload"] for part in decoded_parts}
    required = {".platform", "graphType.json", "dataSources.json",
                "graphDefinition.json", "stylingConfiguration.json"}
    if set(by_path) != required:
        raise DeployError("GraphModel definition must contain exactly five managed parts.")
    graph_type = by_path["graphType.json"]
    graph_definition = by_path["graphDefinition.json"]
    node_types = graph_type.get("nodeTypes") or []
    edge_types = graph_type.get("edgeTypes") or []
    data_sources = by_path["dataSources.json"].get("dataSources") or []
    node_tables = graph_definition.get("nodeTables") or []
    edge_tables = graph_definition.get("edgeTables") or []
    if (len(node_types), len(edge_types), len(data_sources)) != (
            entity_count, relationship_count, data_source_count):
        raise DeployError("GraphModel definition counts differ from the validated workshop model.")
    if len(node_tables) != entity_count or len(edge_tables) != relationship_count:
        raise DeployError("GraphModel table mappings do not cover every node and edge type.")
    if not node_types or not data_sources:
        raise DeployError("GraphModel definition has no queryable graph content.")
