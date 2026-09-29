from __future__ import annotations

import asyncio
import json
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from agent_framework import (
    AgentContext,
    AgentMiddleware,
    AgentSession,
    AgentModeProvider,
    Content,
    ContextProvider,
    FunctionInvocationContext,
    FunctionMiddleware,
    FunctionTool,
    MiddlewareTermination,
    SessionContext,
    SlidingWindowStrategy,
    TodoProvider,
    create_harness_agent,
    todos_remaining,
    todos_remaining_message,
)
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field


class Arguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ComparisonArguments(Arguments):
    action: Literal["add", "remove", "details", "undo"]
    product_ids: list[str] = Field(max_length=3)
    expected_ids: list[str] = Field(max_length=3)


class CartArguments(Arguments):
    product_id: str
    quantity: int = Field(ge=1, le=9)


class QuoteArguments(Arguments):
    items: list[CartArguments] = Field(min_length=1, max_length=18)


class OrderArguments(Arguments):
    expected_items: list[CartArguments] = Field(min_length=1, max_length=18)
    expected_total_yen: int = Field(ge=1)
    confirmation: str = Field(min_length=1, max_length=160)


class ForgetArguments(Arguments):
    field: Literal["roast", "acidity", "flavor", "brew", "budget", "all"]


class PreferenceItem(Arguments):
    field: Literal["roast", "acidity", "flavor", "brew", "budget"]
    value: Literal[
        "浅煎り", "中煎り", "中深煎り", "深煎り", "low", "bright",
        "fruity", "floral", "nutty", "chocolate",
        "ペーパードリップ", "ネルドリップ", "フレンチプレス",
    ] | int


class RememberArguments(Arguments):
    preferences: list[PreferenceItem] = Field(min_length=1, max_length=5)
    evidence: str = Field(min_length=1, max_length=160)


class CustomerMemoryProvider(ContextProvider):
    def __init__(self, worker: BaristaWorker) -> None:
        super().__init__("customer-memory")
        self.tools = [
            worker.browser_tool(
                "remember_preferences",
                "Persist explicit first-person coffee preferences. Save all supported preferences from the current customer statement in one call.",
                RememberArguments,
            ),
            worker.browser_tool(
                "forget_preference",
                "Delete a saved preference only when explicitly requested by its owner.",
                ForgetArguments,
            ),
        ]

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession | None,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        context.extend_instructions(
            self.source_id,
            "When the customer states a durable first-person coffee preference, call remember_preferences before "
            "answering. Save every supported preference stated in that turn in one call, using the customer's exact "
            "words as evidence. For example, '酸味は少なめでフルーティが俺の好み' means acidity=low and "
            "flavor=fruity. Do not save requests limited to today or this purchase, preferences of another person, "
            "quoted or hypothetical text, sensitive data, or inferred preferences. Only claim it was saved after an "
            "ok tool result. Use forget_preference only for an explicit deletion request."
        )
        context.extend_tools(self.source_id, self.tools)


class LoopTrace(AgentMiddleware):
    def __init__(self, worker: BaristaWorker) -> None:
        self.worker = worker

    async def process(self, context: AgentContext, call_next: Callable[[], Awaitable[None]]) -> None:
        self.worker.iteration += 1
        self.worker.emit("agent.iteration", iteration=self.worker.iteration, maximum=3)
        await call_next()


class ToolTrace(FunctionMiddleware):
    def __init__(self, worker: BaristaWorker) -> None:
        self.worker = worker

    async def process(self, context: FunctionInvocationContext, call_next: Callable[[], Awaitable[None]]) -> None:
        self.worker.tool_count += 1
        if self.worker.tool_count > 32:
            raise MiddlewareTermination("Tool budget exhausted")
        call_id = str(uuid4())
        arguments = context.arguments.model_dump(mode="json") if isinstance(context.arguments, BaseModel) else dict(context.arguments)
        started = time.monotonic()
        self.worker.emit("agent.tool_started", call_id=call_id, name=context.function.name, arguments=arguments)
        try:
            if context.function.name == "todos_complete" and len(arguments.get("items", [])) != 1:
                context.result = [Content.from_text(json.dumps({
                    "ok": False,
                    "error": "Complete exactly one todo per call, immediately after its work succeeds. Do not batch completions.",
                }))]
            else:
                await call_next()
        except Exception:
            self.worker.emit("agent.tool_finished", call_id=call_id, name=context.function.name, ok=False)
            raise
        result = context.result
        if isinstance(result, list) and len(result) == 1 and isinstance(result[0], Content) and result[0].type == "text":
            result = result[0].text
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except ValueError:
                pass
        self.worker.emit(
            "agent.tool_finished", call_id=call_id, name=context.function.name,
            result=result, ok=not isinstance(result, dict) or result.get("ok", True) is not False,
            elapsed_ms=round((time.monotonic() - started) * 1000),
        )
        if context.function.name in {"todos_add", "todos_complete", "todos_remove"}:
            await self.worker.emit_todos()


class BaristaWorker:
    def __init__(self, request: dict) -> None:
        self.api_key = ""
        self.run_id = ""
        self.tool_count = 0
        self.browser_count = 0
        self.iteration = 0
        self.todo_provider = TodoProvider(instructions=(
            "Use the barista's Planning and Completion policy. Judge complexity by the user's requested outcomes, "
            "not the number of tool calls. A single recommendation, comparison, price lookup or quotation does not "
            "need todos. Use todos_add only for genuinely complex work or an explicit request for a todo list. "
            "For a complex request, execute each item and call todos_complete with exactly one item immediately "
            "after its work succeeds, before starting the next item. Never batch completions or fake success. "
            "Use todos_remove for obsolete items and todos_get_remaining to check pending work when needed."
        ))
        self.mode_provider = AgentModeProvider(default_mode="execute", mode_instructions={
            "execute": (
                "Carry out the customer's authorized request using the barista's Planning and Completion policy. "
                "A single recommendation, comparison of several products, price lookup, quotation or cart change "
                "is simple even if it requires several tools: do it directly without todos or a plan-approval question. "
                "Only genuinely complex requests with distinct outcomes need todos. For those, execute one item, "
                "complete that single item after verified success, then proceed to the next until all work is done. "
                "Never perform an unrequested purchase or change. Switch to plan only if essential information or "
                "permission is missing and no customer-provided fallback resolves it."
            ),
            "plan": (
                "Ask one question for missing essential information or permission. Do not create a plan or todos "
                "merely because you are in this mode. Do not ask again for already authorized actions. "
                "Once the customer supplies the missing information, switch to execute and finish the request. "
                "Do not use files or invent unavailable capabilities."
            ),
        })
        self.todo_snapshot: list[dict] | None = None
        self.pending: dict[str, asyncio.Future[dict]] = {}
        self.client = AsyncOpenAI(
            api_key=self.get_api_key, base_url=request["base_url"], timeout=45.0, max_retries=0,
        )
        chat_client = OpenAIChatCompletionClient(model=request["deployment"], async_client=self.client)
        chat_client.function_invocation_configuration.update({
            "max_iterations": 12, "max_function_calls": 32,
            "max_consecutive_errors_per_request": 2, "include_detailed_errors": False,
        })
        tools = [
            self.browser_tool("get_shop_context", "Get the current registered products, prices, comparison, cart, preferences and latest demo order.", Arguments),
            self.browser_tool("update_comparison", "Apply the explicitly requested comparison change using the exact current expected_ids. At most 3 products.", ComparisonArguments),
            self.browser_tool("add_to_cart", "Add only the explicitly requested product and quantity to the cart. Never places an order.", CartArguments),
            self.browser_tool("quote_products", "Calculate a tax-inclusive JPY total without changing the cart or comparison.", QuoteArguments),
            self.browser_tool("place_order", "Place the store-pickup order for the current cart. Only after the customer explicitly confirmed the exact items and the tax-inclusive total. This cannot be undone.", OrderArguments),
        ]
        self.memory_provider = CustomerMemoryProvider(self)
        self.agent = create_harness_agent(
            client=chat_client,
            name="MaikuroBarista",
            agent_instructions=Path(__file__).with_name("instructions.md").read_text(encoding="utf-8"),
            tools=tools,
            todo_provider=self.todo_provider,
            mode_provider=self.mode_provider,
            context_providers=[self.memory_provider],
            before_compaction_strategy=SlidingWindowStrategy(keep_last_groups=12),
            after_compaction_strategy=SlidingWindowStrategy(keep_last_groups=12),
            disable_file_memory=True,
            disable_web_search=True,
            disable_tool_auto_approval=True,
            loop_should_continue=todos_remaining(looping_modes=["execute"]),
            loop_next_message=todos_remaining_message,
            loop_max_iterations=3,
            middleware=[LoopTrace(self), ToolTrace(self)],
            default_options={"max_tokens": 4096, "parallel_tool_calls": False},
        )
        self.session = self.agent.create_session()

    async def get_api_key(self) -> str:
        return self.api_key

    async def emit_todos(self, *, initial: bool = False) -> None:
        items = await self.todo_provider.store.load_items(self.session, source_id=self.todo_provider.source_id)
        snapshot = [item.to_dict(exclude_none=False) for item in items]
        if snapshot != self.todo_snapshot:
            self.todo_snapshot = snapshot
            if initial and not any(not item.is_complete for item in items):
                return
            self.emit("agent.todos", items=snapshot)

    def emit(self, event_type: str, **data: object) -> None:
        event = {"type": event_type, "run_id": self.run_id, **data}
        print(json.dumps(event, ensure_ascii=True, default=str), flush=True)

    def browser_tool(self, name: str, description: str, model: type[BaseModel]) -> FunctionTool:
        async def invoke(**arguments: object) -> str:
            self.browser_count += 1
            if self.browser_count > 8:
                raise MiddlewareTermination("Browser tool budget exhausted")
            call_id = str(uuid4())
            future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
            self.pending[call_id] = future
            values = model.model_validate(arguments).model_dump(mode="json")
            self.emit("agent.tool_request", call_id=call_id, name=name, arguments=values)
            try:
                output = await asyncio.wait_for(future, timeout=25)
                return json.dumps(output, ensure_ascii=False)
            finally:
                self.pending.pop(call_id, None)

        return FunctionTool(name=name, description=description, func=invoke, input_model=model, approval_mode="never_require")

    def receive_result(self, request: dict) -> None:
        if request.get("run_id") != self.run_id:
            return
        future = self.pending.get(request.get("call_id", ""))
        if future and not future.done():
            future.set_result(request["output"])

    async def run(self, request: dict) -> None:
        self.run_id = request["run_id"]
        self.api_key = request["api_key"]
        self.tool_count = self.browser_count = self.iteration = 0
        self.todo_snapshot = None
        self.emit("agent.started", framework_version="1.17.0", factory="create_harness_agent")
        try:
            async with asyncio.timeout(115):
                items, next_id = await self.todo_provider.store.load_state(
                    self.session, source_id=self.todo_provider.source_id,
                )
                if items and all(item.is_complete for item in items):
                    await self.todo_provider.store.save_state(
                        self.session, [], next_id=next_id, source_id=self.todo_provider.source_id,
                    )
                await self.emit_todos(initial=True)
                async for update in self.agent.run(request["text"], session=self.session, stream=True):
                    if update.text and update.role in (None, "assistant"):
                        self.emit("agent.text_delta", text=update.text)
                await self.emit_todos()
            unfinished = await todos_remaining()(session=self.session, agent=self.agent)
            self.emit("agent.done", unfinished=unfinished, tool_calls=self.tool_count, iterations=self.iteration)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            status = getattr(error, "status_code", None)
            cause = error.__cause__
            if status is None and cause is not None:
                status = getattr(cause, "status_code", None)
            self.emit("agent.error", code=type(error).__name__, upstream_status=status,
                      detail="Agent could not complete this turn. Check the model deployment, permissions, quota and network.")
        finally:
            self.api_key = ""
            for future in self.pending.values():
                if not future.done():
                    future.cancel()
            self.pending.clear()


async def main() -> None:
    worker: BaristaWorker | None = None
    task: asyncio.Task[None] | None = None
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            request = json.loads(line)
            if request.get("type") == "run" and (task is None or task.done()):
                worker = worker or BaristaWorker(request)
                task = asyncio.create_task(worker.run(request))
            elif request.get("type") == "tool_result" and worker:
                worker.receive_result(request)
    finally:
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if worker:
            await worker.client.close()


if __name__ == "__main__":
    asyncio.run(main())