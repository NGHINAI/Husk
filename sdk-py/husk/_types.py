"""Wire types for Husk JSON-RPC v1.

Mirrors `orchestrator/src/http/methods.ts` return shapes. Kept in sync via tests,
not via shared imports (the SDK has no orchestrator dependency).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Optional, Sequence, Union


Verb = Literal["click", "type", "scroll", "press_key"]
SnapshotStateFlag = Literal["e", "v", "c", "f", "d"]
RejectionReason = Literal[
    "element_not_found",
    "element_not_visible",
    "element_disabled",
    "wrong_role_for_action",
    "policy_forbidden",
    "policy_required_before",
    "policy_domain_denied",
]
WarningReason = Literal[
    "no_mutation_observed",
    "error_alert_appeared",
    "unexpected_navigation",
    "policy_warn",
]


@dataclass(frozen=True, slots=True)
class SnapshotNode:
    i: str
    r: str
    n: str
    s: tuple[SnapshotStateFlag, ...] = ()
    t: Optional[str] = None
    c: tuple["SnapshotNode", ...] = ()


@dataclass(frozen=True, slots=True)
class Snapshot:
    v: Literal[1]
    url: str
    count: int
    root: SnapshotNode


@dataclass(frozen=True, slots=True)
class SnapshotDiff:
    added: tuple[SnapshotNode, ...]
    removed: tuple[str, ...]
    changed: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True, slots=True)
class Candidate:
    stable_id: str
    role: str
    name: str
    score: float


@dataclass(frozen=True, slots=True)
class Warning_:  # `Warning` shadows Python's builtin; re-exported as `Warning` via __init__
    reason: WarningReason
    message: str


@dataclass(frozen=True, slots=True)
class SuccessResult:
    ok: Literal[True]
    warnings: tuple[Warning_, ...] = ()
    diff: Optional[SnapshotDiff] = None


@dataclass(frozen=True, slots=True)
class RejectionEnvelope:
    ok: Literal[False]
    reason: RejectionReason
    verb: Verb
    stable_id_attempted: Optional[str]
    candidates: tuple[Candidate, ...]
    snapshot_at_attempt: Snapshot
    message: Optional[str] = None


ActionResult = Union[SuccessResult, RejectionEnvelope]


# ----- Parsers (raw dict from JSON → dataclass) -----

def parse_snapshot(d: Mapping[str, Any]) -> Snapshot:
    return Snapshot(
        v=1,
        url=d["url"],
        count=d["count"],
        root=_parse_node(d["root"]),
    )


def _parse_node(d: Mapping[str, Any]) -> SnapshotNode:
    return SnapshotNode(
        i=d["i"],
        r=d["r"],
        n=d["n"],
        s=tuple(d.get("s", [])),
        t=d.get("t"),
        c=tuple(_parse_node(c) for c in d.get("c", [])),
    )


@dataclass(frozen=True, slots=True)
class Cookie:
    name: str
    value: str
    domain: str
    path: str
    expires: int
    size: int
    http_only: bool
    secure: bool
    session: bool
    same_site: Optional[str] = None
    url: Optional[str] = None


def parse_cookie(d: Mapping[str, Any]) -> Cookie:
    return Cookie(
        name=d["name"],
        value=d["value"],
        domain=d["domain"],
        path=d["path"],
        expires=d["expires"],
        size=d["size"],
        http_only=d["httpOnly"],
        secure=d["secure"],
        session=d["session"],
        same_site=d.get("sameSite"),
        url=d.get("url"),
    )


def _parse_snapshot_diff(d: Mapping[str, Any]) -> SnapshotDiff:
    return SnapshotDiff(
        added=tuple(_parse_node(n) for n in d.get("added", [])),
        removed=tuple(d.get("removed", [])),
        changed=tuple(d.get("changed", [])),
    )


def parse_action_result(d: Mapping[str, Any]) -> ActionResult:
    if d.get("ok") is True:
        raw_diff = d.get("diff")
        return SuccessResult(
            ok=True,
            warnings=tuple(Warning_(reason=w["reason"], message=w["message"]) for w in d.get("warnings", [])),
            diff=_parse_snapshot_diff(raw_diff) if raw_diff is not None else None,
        )
    return RejectionEnvelope(
        ok=False,
        reason=d["reason"],
        verb=d["verb"],
        stable_id_attempted=d.get("stable_id_attempted"),
        candidates=tuple(
            Candidate(
                stable_id=c["stable_id"], role=c["role"], name=c["name"], score=c["score"]
            )
            for c in d.get("candidates", [])
        ),
        snapshot_at_attempt=parse_snapshot(d["snapshot_at_attempt"]),
        message=d.get("message"),
    )


# ----- Intention / Outcome types (M19 Phase B) -----

FailureReason = Literal[
    # State-machine reasons
    "unknown_site",
    "unknown_state",
    "no_path_to_target",
    "state_drift_mid_execution",
    "verify_failed",
    # Step execution reasons
    "element_not_found",
    "element_not_interactive",
    "watchdog_rejected",
    "timeout",
    # Network reasons
    "network_failure",
    "network_timeout",
    "network_throttled",
    "rate_limited",
    # Site-side reasons
    "account_locked",
    "bot_challenge",
    "two_factor_required",
    "permission_denied",
    "content_not_found",
    "feature_unavailable",
    # Human reasons
    "needs_human",
    "needs_credentials",
    "needs_2fa_code",
    "needs_payment_confirmation",
    "human_declined",
    "human_timeout",
    # Engine reasons
    "engine_unsupported",
    "engine_crashed",
    "out_of_memory",
    "pool_exhausted",
    # Unknown
    "unknown_error",
]


@dataclass
class Evidence:
    predicate: str
    passed: bool
    observed_value: Any = None
    ts: Optional[int] = None
    source: Optional[Literal["url", "network", "ax", "predicate", "text"]] = None
    severity: Optional[Literal["info", "warn", "block"]] = None
    attempts: Optional[int] = None


@dataclass
class Outcome:
    ok: bool
    intention: str
    args: Any
    state_before: Optional[str]
    evidence: list["Evidence"] = field(default_factory=list)
    duration_ms: int = 0
    state_after: Optional[str] = None
    result: Any = None
    reason: Optional[str] = None  # FailureReason Literal
    reason_detail: Optional[str] = None
    recovery_options: list[dict[str, Any]] = field(default_factory=list)
    steps_observed: list[Any] = field(default_factory=list)

    @classmethod
    def from_json(cls, d: Mapping[str, Any]) -> "Outcome":
        return cls(
            ok=d["ok"],
            intention=d["intention"],
            args=d.get("args"),
            state_before=d.get("state_before"),
            state_after=d.get("state_after"),
            result=d.get("result"),
            evidence=[
                Evidence(
                    predicate=e["predicate"],
                    passed=e["passed"],
                    observed_value=e.get("observed_value"),
                    ts=e.get("ts"),
                    source=e.get("source"),
                    severity=e.get("severity"),
                    attempts=e.get("attempts"),
                )
                for e in d.get("evidence", [])
            ],
            duration_ms=d.get("duration_ms", 0),
            reason=d.get("reason"),
            reason_detail=d.get("reason_detail"),
            recovery_options=d.get("recovery_options", []),
            steps_observed=d.get("steps_observed", []),
        )
