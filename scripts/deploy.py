import argparse
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def emit(values):
    print(json.dumps(values, ensure_ascii=False, indent=2))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in values.items():
                if isinstance(value, str) and "\n" not in value and "\r" not in value:
                    output.write(f"{key}={value}\n")


def main():
    parser = argparse.ArgumentParser(description="Prepare and deploy the versioned Micro Coffee data foundation.")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare", help="Validate canonical sources and materialize an immutable local Parquet package; no cloud calls")
    prepare_parser.add_argument("--reference-data", type=Path, help="Explicit versioned World Bank snapshot directory")
    prepare_parser.add_argument("--include-predictions", action="store_true", help="Include the original three gold prediction snapshots without retraining")
    plan_parser = commands.add_parser("plan", help="Create a local approval plan; no cloud calls")
    plan_parser.add_argument("--package", type=Path, required=True)
    plan_parser.add_argument("--config", type=Path)
    plan_parser.add_argument("--environment")
    plan_parser.add_argument("--tenant-id")
    plan_parser.add_argument("--workspace-id")
    plan_parser.add_argument("--without-ontology", action="store_true")
    for command in ("apply", "resume"):
        apply_parser = commands.add_parser(command, help="Apply the approved plan or resume pending operations")
        apply_parser.add_argument("--plan", type=Path, required=True)
        apply_parser.add_argument("--approve-plan", required=True)
        apply_parser.add_argument("--confirm-synthetic", action="store_true")
    status_parser = commands.add_parser("status", help="Show locally recorded state without authentication")
    status_parser.add_argument("--plan", type=Path, required=True)
    recovery_parser = commands.add_parser("record-operation", help="Associate a manually reconciled operation ID; never resubmit unknown writes")
    recovery_parser.add_argument("--plan", type=Path, required=True)
    recovery_parser.add_argument("--step", required=True)
    recovery_parser.add_argument("--operation-id", required=True)
    recovery_parser.add_argument("--approve-plan", required=True)
    recovery_parser.add_argument("--confirm-operation-belongs-to-step", action="store_true", required=True)
    args = parser.parse_args()
    if args.command == "status":
        from uuid import UUID
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
        state_path = ROOT / "artifacts/deployments" / str(UUID(plan["deploymentId"])) / "state.json"
        if not state_path.exists():
            emit({"status": "not-started", "remoteChecked": False})
            return
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state["planHash"] != plan["planHash"]:
            raise ValueError("Recorded state belongs to a different plan")
        print(json.dumps({"status": state["status"], "remoteChecked": False,
                          "steps": {key: {field: value for field, value in step.items() if field in ("status", "handle")}
                                    for key, step in state["steps"].items()},
                          "tableAcceptance": state.get("tableAcceptance"), "acceptance": state.get("acceptance")}, indent=2))
        return
    from accelerator.data import prepare
    from accelerator.deployment import apply, make_plan, record_operation
    if args.command == "prepare":
        output = prepare(args.reference_data, include_predictions=args.include_predictions)
        emit({"package_path": output.relative_to(ROOT).as_posix(), "cloudWrites": False})
    elif args.command == "plan":
        if args.config and (args.environment or args.tenant_id or args.workspace_id or args.without_ontology):
            parser.error("Use --config or explicit environment arguments, not both")
        config = args.config or {"environment": args.environment, "tenantId": args.tenant_id,
                                "workspaceId": args.workspace_id, "includeOntology": not args.without_ontology}
        if not args.config and not all((args.environment, args.tenant_id, args.workspace_id)):
            parser.error("Provide --config or --environment, --tenant-id and --workspace-id")
        path, plan = make_plan(config, args.package)
        emit({"plan_path": path.relative_to(ROOT).as_posix(), "plan_hash": plan["planHash"],
              "create": plan["create"], "tables": len(plan["tables"]), "dataOrigin": plan["dataOrigin"], "cloudWrites": False})
    elif args.command in ("apply", "resume"):
        output = apply(args.plan, args.approve_plan, args.confirm_synthetic)
        emit({"deployment_path": output.relative_to(ROOT).as_posix(), "status": "data-foundation-applied", "applicationReady": False})
    else:
        record_operation(args.plan, args.step, args.operation_id, args.approve_plan)
        emit({"status": "operation-recorded", "cloudWrites": False})


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, FileNotFoundError) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f"Stopped: {type(error).__name__}. Inspect local state; provider response values were not printed.", file=sys.stderr)
        sys.exit(1)