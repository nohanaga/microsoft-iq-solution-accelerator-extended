from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

from azure.identity import AzureCliCredential

from .data import json_bytes, sha256, write_json


API = "https://api.fabric.microsoft.com/v1"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retry_delay(value):
    if not value:
        return 3
    try:
        delay = float(value)
    except ValueError:
        delay = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
    return max(1, min(delay, 300))


class Fabric:
    def __init__(self, tenant_id, state_path, state, timeout=1800):
        self.credential = AzureCliCredential(tenant_id=tenant_id)
        self.state_path = state_path
        self.state = state
        self.timeout = timeout
        self.opener = build_opener(NoRedirect())

    def persist(self):
        write_json(self.state_path, self.state)

    def request(self, method, path, body=None):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("Fabric request must use a relative API path")
        url = API + path
        for attempt in range(6):
            token = self.credential.get_token("https://api.fabric.microsoft.com/.default").token
            headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
            request = Request(url, data=None if body is None else json_bytes(body), headers=headers, method=method)
            try:
                with self.opener.open(request, timeout=90) as response:
                    status, response_headers, content = response.status, response.headers, response.read()
            except HTTPError as error:
                status, response_headers, content = error.code, error.headers, error.read()
            except (URLError, TimeoutError, OSError) as error:
                raise RuntimeError(f"Fabric {method} transport failed; request outcome may be unknown") from error
            if status == 429 or (method == "GET" and status in (500, 502, 503, 504)):
                if attempt < 5:
                    time.sleep(retry_delay(response_headers.get("Retry-After")))
                    continue
            if not 200 <= status < 300:
                try:
                    code = json.loads(content).get("errorCode", "unknown")
                except (ValueError, AttributeError):
                    code = "non-json-response"
                raise RuntimeError(f"Fabric {method} failed: HTTP {status}, code={code}; response values omitted")
            return status, response_headers, json.loads(content) if content.strip() else {}
        raise RuntimeError("Fabric retry budget exhausted")

    def get(self, path):
        return self.request("GET", path)[2]

    def inventory(self, workspace):
        path = f"/workspaces/{workspace}/items"
        seen = set()
        items = []
        while path:
            if path in seen:
                raise RuntimeError("Fabric inventory pagination loop")
            seen.add(path)
            response = self.get(path)
            items.extend(response.get("value", []))
            uri = response.get("continuationUri")
            if response.get("continuationToken") and not uri:
                from urllib.parse import quote
                path = f"/workspaces/{workspace}/items?continuationToken={quote(response['continuationToken'], safe='')}"
            else:
                path = self.safe_path(uri) if uri else None
            if path and not path.startswith(f"/workspaces/{workspace}/items?"):
                raise RuntimeError("Unexpected inventory continuation URI")
        return items

    @staticmethod
    def safe_path(url):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "api.fabric.microsoft.com" or parsed.fragment or not parsed.path.startswith("/v1/"):
            raise RuntimeError("Untrusted Fabric operation URL; no token was forwarded")
        return parsed.path[3:] + ("?" + parsed.query if parsed.query else "")

    def poll(self, handle, needs_result=False, job=False):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            _, headers, result = self.request("GET", handle)
            status = result.get("status", result.get("Status"))
            if status in ("Succeeded", "Completed", 3):
                return self.get(handle.rstrip("/") + "/result") if needs_result and not job else result
            if status in ("Failed", "Cancelled", "Canceled", "Deduped", 4):
                raise RuntimeError(f"Fabric operation ended with {status}; handle={handle}")
            if status not in ("NotStarted", "Running", "InProgress", 0, 1, 2):
                raise RuntimeError(f"Unknown Fabric operation status: {status}; handle={handle}")
            time.sleep(retry_delay(headers.get("Retry-After")))
        raise RuntimeError(f"Fabric operation still pending; use resume. Handle={handle}")

    def post_once(self, key, path, body, needs_result=False, job=False):
        fingerprint = sha256(json_bytes({"path": path, "body": body}))
        steps = self.state.setdefault("steps", {})
        step = steps.get(key)
        if step and step["requestHash"] != fingerprint:
            raise RuntimeError(f"Request changed while resuming: {key}")
        if step and step["status"] == "completed":
            return step["result"]
        if step is None:
            step = {"status": "submitting", "requestHash": fingerprint, "path": path,
                    "needsResult": needs_result, "job": job}
            steps[key] = step
            self.persist()
            status, headers, result = self.request("POST", path, body)
            if status == 202:
                operation_id = headers.get("x-ms-operation-id")
                if job:
                    handle = self.safe_path(headers.get("Location", ""))
                    expected = path.split("?")[0].rstrip("/") + "/"
                    if not handle.startswith(expected):
                        raise RuntimeError("Job response did not identify the requested item's job")
                    UUID(handle.rsplit("/", 1)[1])
                elif operation_id:
                    handle = f"/operations/{UUID(operation_id)}"
                else:
                    handle = self.safe_path(headers.get("Location", ""))
                    if not handle.startswith("/operations/"):
                        raise RuntimeError("Response has no trusted operation ID")
                    UUID(handle.rsplit("/", 1)[1])
                step.update(status="pending", handle=handle)
                self.persist()
            else:
                step.update(status="completed", result=result)
                self.persist()
                return result
        if not step.get("handle"):
            raise RuntimeError(f"Outcome of {key} is unknown. Reconcile the operation ID; it will not be resubmitted.")
        result = self.poll(step["handle"], needs_result, job)
        step.update(status="completed", result=result)
        self.persist()
        return result

    def read_definition(self, workspace, collection, item_id):
        path = f"/workspaces/{workspace}/{collection}/{item_id}/getDefinition"
        status, headers, result = self.request("POST", path, {})
        if status == 202:
            operation_id = UUID(headers["x-ms-operation-id"])
            result = self.poll(f"/operations/{operation_id}", needs_result=True)
        return result["definition"]["parts"]