import base64
from copy import deepcopy
from contextlib import contextmanager
import json
from pathlib import Path
import re
import time
from uuid import NAMESPACE_URL, UUID, uuid5
from urllib.parse import urlparse

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.filedatalake import DataLakeServiceClient

from .data import ROOT, json_bytes, local_path, read_json, sha256, verify_package, write_json
from .fabric import Fabric
from . import graph_definition, ontology


def make_plan(config_path, package_path):
    config = read_json(config_path) if isinstance(config_path, Path) else dict(config_path)
    if set(config) != {"environment", "tenantId", "workspaceId", "includeOntology"}:
        raise ValueError("Unexpected or missing config fields")
    for name in ("tenantId", "workspaceId"):
        config[name] = str(UUID(config[name]))
        if UUID(config[name]).int == 0:
            raise ValueError(f"Set an actual {name}")
    if not re.fullmatch(r"[a-z][a-z0-9-]{2,30}", config["environment"]) or type(config["includeOntology"]) is not bool:
        raise ValueError("Invalid environment or includeOntology")
    package_path = package_path.resolve()
    if not package_path.is_relative_to(ROOT):
        raise ValueError("Prepared package must be inside this repository")
    package = verify_package(package_path)
    prefix = "MicroCoffee_" + config["environment"].replace("-", "_")
    plan = {"schemaVersion": 1, "mode": "create", "config": config,
            "package": package_path.relative_to(ROOT).as_posix(), "packageHash": sha256((package_path / "package.json").read_bytes()),
            "contentId": package["contentId"], "dataOrigin": package["dataOrigin"], "containsSyntheticData": package["containsSyntheticData"],
            "referenceData": package["referenceData"],
            "lakehouseName": prefix + "_Data", "ontologyPrefix": prefix + "_",
            "create": [prefix + "_Data"], "update": [], "delete": [],
            "tables": [{"name": table["name"], "rows": table["rows"], "dataOrigin": table["dataOrigin"]} for table in package["tables"]],
            "graphRefresh": config["includeOntology"], "remotePreflight": "required-at-apply",
            "scope": "Lakehouse, immutable source files, analytical Delta tables, optional Ontology and Graph",
            "notIncluded": ["Semantic Model", "PostgreSQL", "Rayfin app", "Foundry", "RTI", "ML"]}
    if config["includeOntology"]:
        plan["create"].extend(prefix + "_" + name.title() for name in package["models"])
        plan["create"].extend("Ontology-managed Graph for " + name for name in package["models"])
    plan["deploymentId"] = str(uuid5(NAMESPACE_URL, "urn:micro-coffee:deployment:" + sha256(json_bytes(plan))))
    plan["planHash"] = sha256(json_bytes(plan))
    path = ROOT / "artifacts/plans" / (plan["planHash"] + ".json")
    write_json(path, plan)
    return path, plan


def load_plan(path):
    plan = read_json(path)
    fingerprint = plan.pop("planHash")
    if sha256(json_bytes(plan)) != fingerprint:
        raise ValueError("Plan hash mismatch")
    plan["planHash"] = fingerprint
    package_path = local_path(ROOT, plan["package"])
    if sha256((package_path / "package.json").read_bytes()) != plan["packageHash"]:
        raise ValueError("Package changed after planning")
    package = verify_package(package_path)
    if plan["mode"] != "create" or plan["dataOrigin"] != package["dataOrigin"]:
        raise ValueError("Unsupported or inconsistent plan")
    return plan, package_path, package


def record_operation(plan_path, step_name, operation_id, approval):
    plan, _, _ = load_plan(plan_path)
    if approval != plan["planHash"]:
        raise ValueError("Approve the original plan before recording a recovery operation")
    output = ROOT / "artifacts/deployments" / plan["deploymentId"]
    with exclusive(output / ".lock"):
        path = output / "state.json"
        state = read_json(path)
        if state["planHash"] != approval:
            raise ValueError("State belongs to another plan")
        step = state["steps"][step_name]
        if step["status"] != "submitting" or step.get("handle") or step.get("job"):
            raise ValueError("Only a non-job request with an unknown outcome can receive an explicit operation ID")
        step.update(handle=f"/operations/{UUID(operation_id)}", status="pending", manuallyReconciled=True)
        write_json(path, state)


@contextmanager
def exclusive(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("x", encoding="utf-8")
    try:
        handle.write("Deployment in progress. Remove only after confirming no process is running.\n")
        handle.close()
        yield
    finally:
        handle.close()
        path.unlink()


def normalized_sources(value):
    result = deepcopy(value)
    references = {reference["name"]: reference["item"] for reference in result.pop("itemReferences", [])}
    for source in result["dataSources"]:
        properties = source["properties"]
        reference = properties.pop("referenceName", None)
        if reference is not None:
            item = references[reference]
            properties["path"] = f"{UUID(item['workspaceId'])}/{UUID(item['itemId'])}/{properties['path']}"
        else:
            path = properties["path"]
            parsed = urlparse(path)
            if parsed.scheme == "abfss" and parsed.hostname == "onelake.dfs.fabric.microsoft.com" and parsed.username:
                path = str(UUID(parsed.username)) + "/" + parsed.path.lstrip("/")
            elif parsed.scheme == "https" and parsed.netloc == "onelake.dfs.fabric.microsoft.com":
                path = parsed.path.lstrip("/")
            elif parsed.scheme or parsed.query or parsed.fragment:
                raise RuntimeError("Unexpected resolved Graph data source path")
            segments = path.strip("/").split("/")
            if len(segments) != 4 or segments[2] != "Tables":
                raise RuntimeError("Cannot establish resolved Graph workspace, Lakehouse and table identity")
            properties["path"] = f"{UUID(segments[0])}/{UUID(segments[1])}/Tables/{segments[3]}"
    return result


def require_parts(expected_parts, actual_parts):
    actual = {part["path"]: json.loads(base64.b64decode(part["payload"])) for part in actual_parts}

    def contains(expected, value):
        if isinstance(expected, dict):
            return isinstance(value, dict) and all(key in value and contains(child, value[key]) for key, child in expected.items())
        if isinstance(expected, list):
            return isinstance(value, list) and len(expected) == len(value) and all(contains(left, right) for left, right in zip(expected, value))
        return type(expected) is type(value) and expected == value

    for part in expected_parts:
        expected = json.loads(base64.b64decode(part["payload"]))
        value = actual.get(part["path"])
        if part["path"] == "dataSources.json" and value is not None:
            expected, value = normalized_sources(expected), normalized_sources(value)
        if value is None or not contains(expected, value):
            raise RuntimeError(f"Remote definition mismatch: {part['path']}")


def owned_item(client, workspace, item_id, kind, name, marker=None):
    item = client.get(f"/workspaces/{workspace}/items/{item_id}")
    if item.get("id") != item_id or item.get("type") != kind or item.get("displayName") != name:
        raise RuntimeError("Recorded item identity or type differs from the plan")
    if marker is not None and item.get("description") != marker:
        raise RuntimeError("Resource ownership marker changed; refusing to write")
    return item


def upload_sources(client, workspace, lakehouse, package_path, package):
    account = DataLakeServiceClient("https://onelake.dfs.fabric.microsoft.com", credential=client.credential)
    filesystem = account.get_file_system_client(workspace)
    root = f"{lakehouse}/Files/accelerator/micro-coffee/{package['contentId']}"
    created = set()
    try:
        files = {**package["files"], "package.json": sha256((package_path / "package.json").read_bytes())}
        for name, digest in files.items():
            key = "upload:" + name
            if client.state.setdefault("uploads", {}).get(key) == digest:
                continue
            target = root + "/" + name
            segments = target.split("/")
            for length in range(3, len(segments)):
                directory = "/".join(segments[:length])
                if directory not in created:
                    try:
                        filesystem.create_directory(directory)
                    except ResourceExistsError:
                        pass
                    created.add(directory)
            file = filesystem.get_file_client(target)
            content = local_path(package_path, name).read_bytes()
            try:
                if sha256(file.download_file().readall()) != digest:
                    raise RuntimeError(f"Existing OneLake source differs; no overwrite allowed: {name}")
            except ResourceNotFoundError:
                try:
                    file.upload_data(content, overwrite=False)
                except ResourceExistsError:
                    pass
            if sha256(file.download_file().readall()) != digest:
                raise RuntimeError(f"OneLake upload hash mismatch: {name}")
            client.state["uploads"][key] = digest
            client.persist()
    finally:
        account.close()


def create_ontologies(client, plan, package_path, package, output):
    workspace = plan["config"]["workspaceId"]
    lakehouse = client.state["lakehouseId"]
    for name, model in package["models"].items():
        definition = read_json(local_path(package_path, model["definition"]))
        data = read_json(local_path(package_path, model["data"]))
        ontology.compile_model(definition, data, ontology.prepare_model(definition, data), output / "definitions",
                               workspace, lakehouse, graph_definition, display_prefix=plan["ontologyPrefix"])
        compiled = read_json(output / f"definitions/{name}/fabric.generated.json")
        display_name = compiled["ontology"]["displayName"]
        context = client.state.setdefault("ontologies", {}).setdefault(name, {})
        key = "ontology:" + name
        if key not in client.state.get("steps", {}):
            inventory = client.inventory(workspace)
            if any(item["displayName"] == display_name for item in inventory):
                raise RuntimeError(f"Unmanaged Ontology name collision: {display_name}")
            context["previousGraphs"] = [item["id"] for item in inventory if item["type"] == "GraphModel"]
            client.persist()
        result = client.post_once(key, f"/workspaces/{workspace}/ontologies", {
            "displayName": display_name, "description": plan["deploymentId"],
            "definition": compiled["ontology"]["definition"]}, needs_result=True)
        context["ontologyId"] = str(UUID(result["id"]))
        client.persist()
        owned_item(client, workspace, context["ontologyId"], "Ontology", display_name, plan["deploymentId"])
        require_parts(compiled["ontology"]["definition"]["parts"], client.read_definition(workspace, "ontologies", context["ontologyId"]))
        if not context.get("graphId"):
            for attempt in range(12):
                candidates = [item for item in client.inventory(workspace) if item["type"] == "GraphModel"
                              and item["id"] not in context["previousGraphs"] and item["displayName"].startswith(display_name)]
                if len(candidates) > 1:
                    raise RuntimeError("Ambiguous newly created GraphModel; refusing name-only selection")
                if candidates:
                    context.update(graphId=candidates[0]["id"], graphName=candidates[0]["displayName"])
                    client.persist()
                    break
                if attempt < 11:
                    time.sleep(5)
            if not context.get("graphId"):
                raise RuntimeError("Ontology child GraphModel not visible yet; resume later")
        graph_id = context["graphId"]
        owned_item(client, workspace, graph_id, "GraphModel", context["graphName"])
        desired = compiled["graph"]["definition"]["parts"]
        for part in desired:
            if part["path"] == ".platform":
                part["payload"] = ontology.encode({"metadata": {"type": "GraphModel", "displayName": context["graphName"]}})
        if "preservedParts" not in context:
            managed = {part["path"] for part in desired}
            context["preservedParts"] = [part for part in client.read_definition(workspace, "graphModels", graph_id) if part["path"] not in managed]
            client.persist()
        desired.extend(context["preservedParts"])
        client.post_once("graph-definition:" + name, f"/workspaces/{workspace}/graphModels/{graph_id}/updateDefinition",
                         {"definition": {"format": "json", "parts": desired}})
        require_parts(desired, client.read_definition(workspace, "graphModels", graph_id))
        client.post_once("graph-refresh:" + name, f"/workspaces/{workspace}/items/{graph_id}/jobs/instances?jobType=RefreshGraph", {}, job=True)
        label = definition["tables"][0]["entityType"]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", label):
            raise ValueError("Unsupported Graph label")
        response = client.request("POST", f"/workspaces/{workspace}/graphModels/{graph_id}/executeQuery?preview=true",
                                  {"query": f"MATCH (entity:`{label}`) RETURN TO_JSON_STRING(entity) AS entity LIMIT 1;"})[2]
        if response.get("error") or not (response.get("result") or {}).get("data"):
            raise RuntimeError("Graph query did not return the expected entity")
        context["queryAccepted"] = True
        client.persist()


def table_names(client, workspace, lakehouse):
    response = client.get(f"/workspaces/{workspace}/lakehouses/{lakehouse}/tables")
    if response.get("continuationToken") or response.get("continuationUri"):
        raise RuntimeError("Unexpected pagination in this new Lakehouse; refusing incomplete inventory")
    return {table["name"] for table in response.get("data", [])}


def apply(plan_path, approval, confirm_synthetic):
    plan, package_path, package = load_plan(plan_path)
    if approval != plan["planHash"]:
        raise ValueError("Explicit --approve-plan must match the reviewed planHash")
    if package["containsSyntheticData"] and not confirm_synthetic:
        raise ValueError("This package contains synthetic data; pass --confirm-synthetic to acknowledge its provenance")
    workspace = plan["config"]["workspaceId"]
    output = ROOT / "artifacts/deployments" / plan["deploymentId"]
    with exclusive(output / ".lock"):
        state_path = output / "state.json"
        state = read_json(state_path) if state_path.exists() else {"planHash": plan["planHash"], "status": "in-progress", "steps": {}}
        if state["planHash"] != plan["planHash"]:
            raise ValueError("State belongs to another approved plan")
        client = Fabric(plan["config"]["tenantId"], state_path, state)
        client.persist()
        try:
            client.get(f"/workspaces/{workspace}")
            if "lakehouse" not in state["steps"] and any(item["displayName"] == plan["lakehouseName"] for item in client.inventory(workspace)):
                raise RuntimeError("Unmanaged Lakehouse name collision; no existing item will be adopted")
            result = client.post_once("lakehouse", f"/workspaces/{workspace}/lakehouses", {
                "displayName": plan["lakehouseName"], "description": plan["deploymentId"],
            }, needs_result=True)
            lakehouse = str(UUID(result["id"]))
            state["lakehouseId"] = lakehouse
            client.persist()
            owned_item(client, workspace, lakehouse, "Lakehouse", plan["lakehouseName"], plan["deploymentId"])
            details = client.get(f"/workspaces/{workspace}/lakehouses/{lakehouse}")
            if details.get("properties", {}).get("defaultSchema"):
                raise RuntimeError("Schema-enabled Lakehouse is not supported by this loader")
            upload_sources(client, workspace, lakehouse, package_path, package)
            for table in package["tables"]:
                if "load:" + table["name"] not in state["steps"] and table["name"] in table_names(client, workspace, lakehouse):
                    raise RuntimeError(f"Unmanaged table already exists; refusing overwrite: {table['name']}")
                client.post_once("load:" + table["name"], f"/workspaces/{workspace}/lakehouses/{lakehouse}/tables/{table['name']}/load", {
                    "relativePath": f"Files/accelerator/micro-coffee/{package['contentId']}/{table['path']}",
                    "pathType": "File", "mode": "Overwrite", "recursive": False, "formatOptions": {"format": "Parquet"},
                })
            remote = table_names(client, workspace, lakehouse)
            if any(table["name"] not in remote for table in package["tables"]):
                raise RuntimeError("Not all loaded Delta tables are visible; resume later")
            state["tableAcceptance"] = {"loadOperationsCompleted": len(package["tables"]), "allTableNamesPresent": True,
                                        "remoteRowCountsVerified": False}
            client.persist()
            if plan["config"]["includeOntology"]:
                create_ontologies(client, plan, package_path, package, output)
            state["status"] = "data-foundation-applied"
            state["acceptance"] = {"scope": plan["scope"], "mcpAcceptance": "not-run", "applicationAcceptance": "not-run"}
            client.persist()
            write_json(output / "runtime.public.json", {"workspaceId": workspace, "lakehouseId": lakehouse,
                       "dataOrigin": package["dataOrigin"], "contentId": package["contentId"],
                       "graphs": {name: value["graphId"] for name, value in state.get("ontologies", {}).items()},
                       "semanticModelId": None, "rayfinItemId": None, "applicationReady": False})
            return output
        except Exception:
            state["status"] = "incomplete"
            client.persist()
            raise
        finally:
            client.credential.close()