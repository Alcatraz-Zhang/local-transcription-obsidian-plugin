from gateway_app.formatter import normalize_response


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
    assert payload["sentence_info"][0] == payload["segments"][0]


def test_normalize_response_preserves_voiceprint_match_metadata():
    payload = normalize_response(
        {
            "sentence_info": [
                {
                    "speaker_id": "Speaker1",
                    "start_time": 0,
                    "end_time": 1.2,
                    "text": "hello",
                    "matched_speaker_id": "vp_alice",
                    "matched_speaker_name": "Alice",
                    "speaker_confidence": 0.87,
                    "speaker_match_status": "matched",
                },
                {
                    "speaker_id": "Speaker2",
                    "start_time": 1.2,
                    "end_time": 2.4,
                    "text": "world",
                    "speaker_match": {
                        "speaker_id": "vp_bob",
                        "display_name": "Bob",
                        "confidence": 0.76,
                        "status": "matched",
                    },
                },
                {
                    "speaker_id": "Speaker3",
                    "start_time": 2.4,
                    "end_time": 3.6,
                    "text": "alias",
                    "matched_speaker_id": "vp_carol",
                    "matched_display_name": "Carol",
                    "speaker_confidence": "0.65",
                },
                {
                    "speaker_id": "Speaker4",
                    "start_time": 3.6,
                    "end_time": 4.8,
                    "text": "invalid",
                    "matched_speaker_id": "vp_dave",
                    "speaker_confidence": "not-a-number",
                },
                {
                    "speaker_id": "Speaker5",
                    "start_time": 4.8,
                    "end_time": 6.0,
                    "text": "direct aliases",
                    "speaker_profile_id": "vp_erin",
                    "speaker_name": "Erin",
                    "confidence": "0.91",
                },
            ]
        }
    )

    assert payload["segments"][0]["speaker_match"] == {
        "speaker_id": "vp_alice",
        "display_name": "Alice",
        "confidence": 0.87,
        "status": "matched",
    }
    assert payload["segments"][1]["speaker_match"] == {
        "speaker_id": "vp_bob",
        "display_name": "Bob",
        "confidence": 0.76,
        "status": "matched",
    }
    assert payload["segments"][2]["speaker_match"] == {
        "speaker_id": "vp_carol",
        "display_name": "Carol",
        "confidence": 0.65,
    }
    assert payload["segments"][3]["speaker_match"] == {
        "speaker_id": "vp_dave",
    }
    assert payload["segments"][4]["speaker_match"] == {
        "speaker_id": "vp_erin",
        "display_name": "Erin",
        "confidence": 0.91,
    }
