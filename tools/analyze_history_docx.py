import json
import re
import sys
from collections import Counter
from pathlib import Path

from docx import Document


HEADER_RE = re.compile(
    r"(?:非我行主承|我行联席主承|我行牵头主承|我行牵头、独立主承|我行主承|联席主承|牵头主承).*(?:分行|总行)"
)
STANDARD_OPINION_RE = re.compile(r"分行申请与资金(?:营运|运营)中心(?:一二级)?联动投资")
ABS_OPINION_RE = re.compile(r"【[^】]*簿记】.*分行拟与资金营运中心联动投资")
FINAL_RE = re.compile(r"以上妥否，请领导审核")


def classify(text):
    if HEADER_RE.search(text):
        return "header"
    if ABS_OPINION_RE.search(text):
        return "abs_opinion"
    if STANDARD_OPINION_RE.search(text):
        return "standard_opinion"
    if FINAL_RE.search(text):
        return "other_final"
    if "询价区间" in text:
        return "inquiry"
    if "市场估值" in text:
        return "valuation"
    if "指导价" in text:
        return "guidance"
    if "规模" in text and "/隐含" in text:
        return "terms"
    return "other"


def main():
    path = Path(sys.argv[1])
    document = Document(path)
    paragraphs = [
        {
            "sourceIndex": index,
            "text": paragraph.text.strip(),
        }
        for index, paragraph in enumerate(document.paragraphs)
        if paragraph.text.strip()
    ]
    for item in paragraphs:
        item["type"] = classify(item["text"])

    counts = Counter(item["type"] for item in paragraphs)
    header_indexes = [index for index, item in enumerate(paragraphs) if item["type"] == "header"]
    blocks = []
    for position, start in enumerate(header_indexes):
        end = header_indexes[position + 1] if position + 1 < len(header_indexes) else len(paragraphs)
        items = paragraphs[start:end]
        standard = [item for item in items if item["type"] == "standard_opinion"]
        abs_opinions = [item for item in items if item["type"] == "abs_opinion"]
        blocks.append({
            "rank": position,
            "header": items[0]["text"],
            "itemCount": len(items),
            "types": Counter(item["type"] for item in items),
            "standardOpinionCount": len(standard),
            "absOpinionCount": len(abs_opinions),
            "hasFinal": any(FINAL_RE.search(item["text"]) for item in items),
            "items": items,
        })

    block_shape_counts = Counter(
        (
            block["standardOpinionCount"],
            block["absOpinionCount"],
            block["hasFinal"],
        )
        for block in blocks
    )
    anomalies = [
        block for block in blocks
        if not (
            (block["standardOpinionCount"] == 1 and block["absOpinionCount"] == 0)
            or (block["standardOpinionCount"] == 0 and block["absOpinionCount"] in (1, 2))
        )
    ]
    abs_blocks = [block for block in blocks if block["absOpinionCount"]]
    report = {
        "paragraphCount": len(paragraphs),
        "classificationCounts": counts,
        "headerCount": len(header_indexes),
        "preambleCount": header_indexes[0] if header_indexes else len(paragraphs),
        "blockShapeCounts": [
            {"standard": shape[0], "abs": shape[1], "hasFinal": shape[2], "count": count}
            for shape, count in block_shape_counts.most_common()
        ],
        "anomalyCount": len(anomalies),
        "anomalySamples": [
            {
                "rank": block["rank"],
                "header": block["header"],
                "standard": block["standardOpinionCount"],
                "abs": block["absOpinionCount"],
                "hasFinal": block["hasFinal"],
                "items": [item["text"][:300] for item in block["items"][:12]],
            }
            for block in anomalies[:30]
        ],
        "absBlockCount": len(abs_blocks),
        "absShapeCounts": Counter(block["absOpinionCount"] for block in abs_blocks),
        "absSamples": [
            {
                "rank": block["rank"],
                "header": block["header"],
                "items": [item["text"][:600] for item in block["items"]],
            }
            for block in abs_blocks[:12]
        ],
        "headerSamples": [block["header"] for block in blocks[:20]],
    }

    def default(value):
        if isinstance(value, Counter):
            return dict(value)
        raise TypeError(type(value).__name__)

    print(json.dumps(report, ensure_ascii=False, indent=2, default=default))


if __name__ == "__main__":
    main()
