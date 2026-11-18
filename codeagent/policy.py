"""Triage input sanitation, schema validation, and lane enforcement."""

import re

CREDENTIAL = re.compile(
    r"sk-[\w-]{12,}|AIza[\w-]{20,}|gh[pousr]_\w{15,}|github_pat_\w{15,}"
    r"|-----BEGIN [^-]*PRIVATE KEY-----.*?(?:-----END [^-]*PRIVATE KEY-----|$)",
    re.DOTALL,
)
COMMENTS = re.compile(r"<!--.*?(?:-->|$)", re.DOTALL)
ESCALATE = {
    "credential_exposure", "weakens_safeguard", "touches_protected_paths",
    "security_sensitive", "paid_service_default", "requires_audio_or_device",
}


def sanitize(text):
    redacted, exposed = CREDENTIAL.subn("[redacted credential]", text or "")
    cleaned, hidden = COMMENTS.subn("", redacted)
    return cleaned, bool(hidden), bool(exposed)


def validate(result, schema):
    if not isinstance(result, dict) or set(result) != set(schema["required"]):
        raise ValueError("Invalid triage fields")

    def valid(item, definition):
        return isinstance(item, str) and ("enum" not in definition or item in definition["enum"])

    for name, rule in schema["properties"].items():
        value = result[name]
        if rule["type"] == "array":
            ok = isinstance(value, list) and all(valid(item, rule["items"]) for item in value)
        else:
            ok = valid(value, rule)
        if not ok:
            raise ValueError(f"Invalid triage field: {name}")
    return result


def decide(result, hidden=False, exposed=False):
    flags = set(result["risk_flags"])
    if hidden:
        flags.add("hidden_instructions")
    if exposed:
        flags.add("credential_exposure")
    model_lane = result["lane"]
    eligible = (
        result["size"] in {"xs", "s"} and result["verifiable"] == "yes"
        and not flags and not result["needs_human_input"] and not result["clarifying_questions"]
        and any(item.strip() for item in result["acceptance_criteria"])
        and any(item.strip() for item in result["verification_plan"])
    )
    if "credential_exposure" in flags:
        lane = "escalate"
    elif result["type"] == "invalid":
        lane = "ignore"
    elif (result["type"] == "question" or result["verifiable"] == "no"
          or flags & ESCALATE or model_lane in {"ignore", "escalate"}):
        lane = "escalate"
    elif model_lane == "auto" and eligible:
        lane = "auto"
    else:
        lane = "assisted"
    return {**result, "model_lane": model_lane, "lane": lane, "risk_flags": sorted(flags)}
