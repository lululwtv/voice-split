"""Readable transcript projection; original attribution rows remain editable."""


def _identity(row):
    if row.get("overlap"):
        return None
    if row.get("profile_id"):
        return ("person", row["profile_id"])
    if row.get("unknown_id"):
        return ("unknown", row["unknown_id"], row.get("speaker"))
    if row.get("track_id") and row.get("stream_id"):
        return ("track", row["track_id"], row.get("speaker"))
    return None


def transcript_turns(segments):
    """Group adjacent chunks without rewriting speech or collapsing unknown people.

    Keep this presentation policy aligned with src/lib/transcriptTurns.ts.
    """
    turns = []
    previous = None
    for row in segments:
        identity = _identity(row)
        joins = (previous is not None and identity is not None and identity == _identity(previous)
                 and row.get("stream_id") == previous.get("stream_id")
                 and row.get("device_id") == previous.get("device_id")
                 and row["start"] >= previous["start"] and row["end"] >= previous["end"]
                 and -.3 <= row["start"] - previous["end"] <= 1.5)
        text = row["text"].strip()
        if joins:
            turn = turns[-1]
            separator = "" if not turn["text"] or not text or text[0] in ",.;:!?…" else " "
            turn["text"] += separator + text
            turn["end"] = row["end"]
        else:
            turns.append({"start": row["start"], "end": row["end"],
                          "speaker": row.get("speaker", "Unknown"), "text": text})
        previous = row
    return turns
