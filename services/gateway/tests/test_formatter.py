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
