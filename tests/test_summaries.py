import io
import json
import urllib.error

import pytest

from voice_split import summaries


ROWS = [{"id": "one", "text": "Alex will ship on Friday.", "profile_id": "alex",
         "speaker": "Alex", "start": 0, "end": 2}]
SUMMARY = {"overview": "Shipping discussed.", "decisions": [], "questions": [],
           "actions": [{"text": "Ship", "sources": ["one"], "ownerId": "alex", "due": "Friday"}]}


def response(value, stop="end_turn"):
    return io.BytesIO(json.dumps({"stop_reason": stop,
        "content": [{"type": "text", "text": json.dumps(value)}]}).encode())


def test_anthropic_model_prompt_and_parsed_sources(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    def send(request, timeout):
        body = json.loads(request.data)
        assert body["model"] == "claude-haiku-5-5"
        assert json.loads(body["messages"][0]["content"])["segments"] == ROWS
        assert request.get_header("X-api-key") == "test-secret"
        assert timeout == 90
        return response(SUMMARY)
    monkeypatch.setattr(summaries.urllib.request, "urlopen", send)
    assert summaries.generate_summary("Planning", ROWS) == SUMMARY


@pytest.mark.parametrize("patch", [
    {"sources": ["invented"]}, {"ownerId": "invented"}, {"sources": []},
])
def test_rejects_unsupported_references(monkeypatch, patch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    invalid = {**SUMMARY, "actions": [{**SUMMARY["actions"][0], **patch}]}
    monkeypatch.setattr(summaries.urllib.request, "urlopen", lambda *a, **k: response(invalid))
    with pytest.raises(RuntimeError, match="invalid summary"):
        summaries.generate_summary("Planning", ROWS)


def test_empty_and_incomplete_transcripts_are_not_saved(monkeypatch):
    with pytest.raises(ValueError, match="Record a transcript"):
        summaries.generate_summary("Empty", [])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    monkeypatch.setattr(summaries.urllib.request, "urlopen", lambda *a, **k: response(SUMMARY, "max_tokens"))
    with pytest.raises(RuntimeError, match="invalid summary"):
        summaries.generate_summary("Planning", ROWS)


def test_provider_errors_do_not_expose_credentials(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    def fail(*a, **k):
        raise urllib.error.HTTPError("https://api.anthropic.com", 401, "test-secret", {}, None)
    monkeypatch.setattr(summaries.urllib.request, "urlopen", fail)
    with pytest.raises(RuntimeError, match="rejected the API key") as caught:
        summaries.generate_summary("Planning", ROWS)
    assert "test-secret" not in str(caught.value)
