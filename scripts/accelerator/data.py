import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone

from jsonschema import Draft202012Validator, FormatChecker
import pyarrow as pa
import pyarrow.parquet as pq

from . import ontology


ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "scenarios/micro-coffee"
SOURCES = {"operations": "operations", "development": "development", "voices": "voice-sources",
           "chats": "ec-chat-history", "sentiments": "voice-sentiments"}
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(json_bytes(value) + b"\n")
    temporary.replace(path)


def local_path(base, relative):
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError("Path escapes the package directory")
    return path


def code_fingerprint():
    paths = sorted((ROOT / "scripts/accelerator").glob("*.py"))
    paths.extend([ROOT / "scripts/deploy.py", ROOT / "scripts/requirements.txt"])
    return sha256(json_bytes({path.relative_to(ROOT).as_posix(): sha256(path.read_bytes()) for path in paths}))


def scalar_shape(prop):
    shapes = prop.get("anyOf", [prop])
    nullable = any(shape.get("type") == "null" for shape in shapes)
    concrete = [shape for shape in shapes if shape.get("type") != "null"]
    if len(concrete) != 1:
        raise ValueError("Unsupported union in source schema")
    shape = dict(concrete[0])
    if isinstance(shape.get("type"), list):
        nullable = nullable or "null" in shape["type"]
        kinds = [kind for kind in shape["type"] if kind != "null"]
        if len(kinds) != 1:
            raise ValueError("Unsupported scalar type union")
        shape["type"] = kinds[0]
    if shape.get("type") not in {"string", "integer", "number", "boolean"}:
        raise ValueError("Only explicit scalar columns can be loaded")
    return shape, nullable


def table_rows(spec, sources):
    source, table = spec["source"], spec["table"]
    if source == "metadata":
        rows = [{"id": key, "source": key, "payload": json_bytes({name: value for name, value in raw.items()
                 if not isinstance(value, list)}).decode("utf-8")} for key, raw in sources.items() if key in SOURCES]
    elif source == "chats" and table == "messages":
        rows = [{**message, "conversationId": conversation["id"], "sequence": sequence}
                for conversation in sources["chats"]["conversations"]
                for sequence, message in enumerate(conversation["messages"])]
    else:
        rows = sources[source][table]
    projected = []
    for row in rows:
        item = {name: row[name] for name in spec["fields"] if name in row}
        if "topics" in item:
            item["topics"] = json_bytes(item["topics"]).decode("utf-8")
        projected.append(item)
    return projected


def arrow_table(spec, rows):
    schema = spec["schema"]
    if set(schema["properties"]) != set(spec["fields"]) or len(set(spec["fields"])) != len(spec["fields"]) or any(not NAME.fullmatch(name) for name in spec["fields"]):
        raise ValueError(f"Column schema mismatch: {spec['name']}")
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    fields = []
    for name in spec["fields"]:
        prop = schema["properties"][name]
        shape, nullable = scalar_shape(prop)
        dtype = {"string": pa.string(), "integer": pa.int64(), "number": pa.float64(), "boolean": pa.bool_()}[shape["type"]]
        if shape.get("format") == "date-time":
            dtype = pa.timestamp("ms", tz="UTC")
        fields.append(pa.field(name, dtype, nullable=nullable or name not in schema.get("required", [])))
    keys = set()
    converted = []
    for index, row in enumerate(rows):
        if next(validator.iter_errors(row), None) is not None:
            raise ValueError(f"Schema validation failed: {spec['name']} row {index}; values omitted")
        key = tuple(row.get(name) for name in spec["primaryKey"])
        if not key or any(value is None or value == "" for value in key) or key in keys:
            raise ValueError(f"Missing or duplicate primary key: {spec['name']} row {index}")
        keys.add(key)
        result = {}
        for field in fields:
            value = row.get(field.name)
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"Non-finite number: {spec['name']}.{field.name}")
            if value is not None and pa.types.is_timestamp(field.type):
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if value.tzinfo is None:
                    raise ValueError(f"Timezone missing: {spec['name']}.{field.name}")
                value = value.astimezone(timezone.utc)
            result[field.name] = value
        converted.append(result)
    return pa.Table.from_pylist(converted, schema=pa.schema(fields))


def validate_references(sources):
    operations = sources["operations"]
    for name in ("voices", "chats", "sentiments"):
        if sources[name]["datasetId"] != operations["datasetId"]:
            raise ValueError(f"Dataset mismatch: {name}")
    references = [
        (operations["reviews"], "lineId", operations["orderLines"], False),
        (operations["reviews"], "customerId", operations["customers"], False),
        (operations["reviewTopics"], "reviewId", operations["reviews"], False),
        (operations["serviceFeedback"], "orderId", operations["orders"], False),
        (sources["voices"]["entries"], "productId", operations["products"], False),
        (sources["voices"]["entries"], "storeId", operations["stores"], True),
        (sources["chats"]["conversations"], "storeId", operations["stores"], True),
        ([message for conversation in sources["chats"]["conversations"] for message in conversation["messages"]],
         "productId", operations["products"], True),
    ]
    for rows, column, targets, nullable in references:
        keys = {row["id"] for row in targets}
        if any(row[column] not in keys and not (nullable and row[column] is None) for row in rows):
            raise ValueError(f"Orphan reference: {column}; values omitted")
    development = sources["development"]
    for recipe in development["recipes"]:
        lines = [line for line in development["recipeLines"] if line["recipeId"] == recipe["id"]]
        if not lines or abs(sum(line["percent"] for line in lines) - 100) > 0.001:
            raise ValueError("Recipe percentages must sum to 100")


def prediction_specs():
    definitions = [
        ("gold_shipment_risk", "shipmentRisk", ["shipmentId"], [
            ("shipmentId", "string"), ("supplierId", "string"), ("storeId", "string"),
            ("isValidation", "boolean"), ("delayProbability", "number"), ("predictedDelayHours", "number"),
            ("shortageProbability", "number"), ("jointShortageProbability", "number"),
            ("expectedLossExTax", "number"), ("expectedImpactedLines", "number"),
            ("actualDelayed", "boolean"), ("actualShortage", "boolean"),
            ("actualAmountExTax", "number"), ("modelVersion", "string"),
        ]),
        ("gold_demand_forecast", "demandForecast", ["date", "storeId", "productId"], [
            ("date", "string"), ("storeId", "string"), ("productId", "string"), ("category", "string"),
            ("yhat", "number"), ("yhatLower", "number"), ("yhatUpper", "number"),
            ("horizonDay", "integer"), ("modelVersion", "string"),
        ]),
        ("gold_bean_depletion", "beanDepletion", ["materialId"], [
            ("materialId", "string"), ("closingGrams", "number"), ("reservedGrams", "number"),
            ("availableGrams", "number"), ("meanDailyGrams", "number"), ("coverDays", ["number", "null"]),
            ("depletionDate", ["string", "null"]), ("depletionDayIndex", ["integer", "null"]),
            ("withinHorizon", "boolean"), ("horizonDays", "integer"), ("modelVersion", "string"),
        ]),
    ]
    return [{"name": name, "source": "predictions", "table": table, "primaryKey": keys,
             "fields": [field for field, _kind in columns],
             "schema": {"type": "object", "additionalProperties": False,
                        "required": [field for field, _kind in columns],
                        "properties": {field: {"type": kind} for field, kind in columns}}}
            for name, table, keys, columns in definitions]


def prepare(reference_path=None, include_predictions=False):
    lock = read_json(SCENARIO / "sources.lock.json")
    if lock["dataOrigin"] != "synthetic":
        raise ValueError("This imported scenario is synthetic; real data requires a separately reviewed source manifest.")
    inputs = {}
    for record in lock["records"]:
        if not record["target"].startswith("scenarios/micro-coffee/"):
            continue
        path = local_path(ROOT, record["target"])
        if sha256(path.read_bytes()) != record["targetSha256"]:
            raise ValueError(f"Source changed since import: {record['target']}; review and version the source lock.")
        inputs[path.relative_to(SCENARIO).as_posix()] = path
    sources = {key: read_json(SCENARIO / f"data/{name}.json") for key, name in SOURCES.items()}
    if include_predictions:
        sources["predictions"] = {key: value for key, value in read_json(SCENARIO / "data/predictions.json").items()
                                  if key not in {"workspaceId", "lakehouseId"}}
    if any(source.get("dataOrigin", "synthetic") != "synthetic" for source in sources.values()):
        raise ValueError("Source provenance differs from the synthetic scenario declaration")
    validate_references(sources)
    models = {}
    for name, source in (("development", "development"), ("supply", "operations")):
        definition = read_json(SCENARIO / f"ontology/{name}.json")
        ontology.prepare_model(definition, sources[source])
        models[name] = {"definition": f"raw/ontology/{name}.json", "data": f"raw/data/{SOURCES[source]}.json"}
    specifications = read_json(SCENARIO / "table-schemas.json")["tables"]
    if include_predictions:
        specifications.extend(prediction_specs())
    names = [spec["name"] for spec in specifications]
    if len(names) != len(set(names)) or any(not NAME.fullmatch(name) for name in names):
        raise ValueError("Invalid or duplicate table names")
    prepared = [(spec, arrow_table(spec, table_rows(spec, sources))) for spec in specifications]
    references = []
    if reference_path is not None:
        reference_path = reference_path.resolve()
        if not reference_path.is_relative_to(SCENARIO / "reference-data"):
            raise ValueError("Public data must be a reviewed snapshot under the scenario reference-data directory")
        provenance_path = reference_path / "provenance.json"
        provenance = read_json(provenance_path)
        if provenance["sourceId"] != "world-bank-coffee" or provenance["dataOrigin"] != "public-statistic" or provenance["license"] != "CC-BY-4.0":
            raise ValueError("Unsupported public data provenance")
        if set(provenance["files"]) != {"prices.json", "table-schema.json"}:
            raise ValueError("Unexpected public data snapshot files")
        inputs[provenance_path.relative_to(SCENARIO).as_posix()] = provenance_path
        for name, expected in provenance["files"].items():
            path = local_path(reference_path, name)
            if sha256(path.read_bytes()) != expected:
                raise ValueError(f"Public data snapshot hash mismatch: {name}")
            inputs[path.relative_to(SCENARIO).as_posix()] = path
        spec = read_json(reference_path / "table-schema.json")
        rows = read_json(reference_path / "prices.json")["rows"]
        if spec["name"] != "mc_ref_world_bank_coffee_prices" or spec["name"] in names or spec["dataOrigin"] != "public-statistic" or len(rows) != provenance["rows"]:
            raise ValueError("Public data table identity or row count mismatch")
        prepared.append((spec, arrow_table(spec, rows)))
        references.append({"sourceId": provenance["sourceId"], "sourceSha256": provenance["sourceSha256"],
                           "provenance": "raw/" + provenance_path.relative_to(SCENARIO).as_posix()})
    content_id = sha256(json_bytes({"sources": {name: sha256(path.read_bytes()) for name, path in inputs.items()},
                                  "code": code_fingerprint(), "sourceLock": sha256(json_bytes(lock)),
                                  "includePredictions": include_predictions}))
    output = ROOT / "artifacts/packages" / content_id
    if output.exists():
        verify_package(output)
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary) / "package"
        staging.mkdir()
        for name, path in inputs.items():
            target = staging / "raw" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        write_json(staging / "sources.lock.json", lock)
        tables = []
        for spec, arrow in prepared:
            target = staging / "tables" / f"{spec['name']}.parquet"
            target.parent.mkdir(exist_ok=True)
            pq.write_table(arrow, target, compression="snappy", version="1.0", coerce_timestamps="ms", allow_truncated_timestamps=False)
            tables.append({"name": spec["name"], "rows": arrow.num_rows, "path": target.relative_to(staging).as_posix(),
                           "dataOrigin": spec.get("dataOrigin", "synthetic"),
                           "primaryKey": spec["primaryKey"], "columns": [{"name": field.name, "type": str(field.type),
                           "nullable": field.nullable} for field in arrow.schema]})
        files = {path.relative_to(staging).as_posix(): sha256(path.read_bytes()) for path in sorted(staging.rglob("*")) if path.is_file()}
        write_json(staging / "package.json", {"schemaVersion": 1, "contentId": content_id, "dataOrigin": "mixed" if references else "synthetic",
               "containsSyntheticData": True, "referenceData": references,
                   "generatorHash": code_fingerprint(), "tables": tables, "models": models, "files": files,
                   "includePredictions": include_predictions,
                   "exclusions": ([] if include_predictions else ["ML predictions"]) +
                                 ["ML training", "RTI streams", "Rayfin SQL seed", "EC PostgreSQL seed"],
                   "dataValidation": "all analytical rows, primary keys, ontology relations, additional references and recipe totals"})
        staging.rename(output)
    return output


def verify_package(path):
    package = read_json(path / "package.json")
    if package["schemaVersion"] != 1 or package["generatorHash"] != code_fingerprint():
        raise ValueError("Package generator changed; prepare and approve a new package")
    for name, expected in package["files"].items():
        if sha256(local_path(path, name).read_bytes()) != expected:
            raise ValueError(f"Package file hash mismatch: {name}")
    for table in package["tables"]:
        if table["path"] not in package["files"] or not NAME.fullmatch(table["name"]):
            raise ValueError("Invalid table in package manifest")
    return package