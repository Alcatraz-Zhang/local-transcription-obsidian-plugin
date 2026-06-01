from gateway_app.formatter import normalize_response, render_text_transcript


def test_normalize_response_accepts_qwen_segments_and_sentence_info():
    payload = normalize_response(
        {
            "result": " language zh<asr_text>大家好",
            "sentence_info": [
                {
                    "speaker_id": "Speaker1",
                    "start_time": 0,
                    "end_time": 1.2,
                    "text": " language zh<asr_text>大家好",
                }
            ],
        }
    )

    assert payload["text"] == "大家好"
    assert payload["segments"][0] == {
        "start": 0.0,
        "end": 1.2,
        "speaker": "Speaker1",
        "text": "大家好",
    }


def test_render_text_transcript_supports_all_output_modes():
    payload = {
        "segments": [
            {"start": 0, "end": 2.4, "speaker": "Speaker1", "text": "大家好。"},
            {"start": 65, "end": 67, "speaker": "Speaker2", "text": "今天讨论项目。"},
        ]
    }

    assert render_text_transcript(payload, "speaker_timestamp") == (
        "[00:00:00 - 00:00:02] Speaker1: 大家好。\n"
        "[00:01:05 - 00:01:07] Speaker2: 今天讨论项目。\n"
    )
    assert render_text_transcript(payload, "timestamp") == (
        "[00:00:00 - 00:00:02] 大家好。\n"
        "[00:01:05 - 00:01:07] 今天讨论项目。\n"
    )
    assert render_text_transcript(payload, "plain") == "大家好。\n今天讨论项目。\n"
