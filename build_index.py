"""사용설명서 PDF -> public/chunks.json (브라우저 검색용 지식 조각) 생성 스크립트.

사용법:  python build_index.py [PDF경로]
PDF가 바뀌면 이 스크립트를 다시 실행한 뒤 커밋/배포하면 됩니다.
"""
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

DEFAULT_PDF = Path(__file__).parent / "docs" / "manual.pdf"
OUT = Path(__file__).parent / "public" / "chunks.json"

# 표지·브랜드 문구·목차·간지·타 제품 광고 페이지는 제외 (검색 잡음 방지)
SKIP_PAGES = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 20, 32, 41, 46, 48}

# 페이지별 섹션 제목 (검색 정확도 및 출처 표기용)
SECTIONS = [
    (10, 10, "제품 사양"),
    (12, 13, "안전을 위한 주의 사항"),
    (14, 16, "제품 설치하기"),
    (17, 18, "제품 구성 및 명칭"),
    (19, 19, "음식물 투입 시 유의사항"),
    (21, 21, "버튼부 이해하기"),
    (22, 23, "동작시간 표시부 안내"),
    (24, 25, "Auto모드 사용하기"),
    (26, 27, "음성 자가진단 기능 / 보관모드"),
    (28, 28, "중량초기화 / 수동모드 / 음소거(볼륨)"),
    (29, 29, "절전 기능 / 건조통 기능"),
    (30, 31, "필터 교체하기 / 필터 교체 주기"),
    (33, 33, "세척모드 사용하기"),
    (34, 35, "건조통 관리 / 도어 세척하기"),
    (36, 37, "자주하는 질문"),
    (38, 40, "고장 신고 전 확인하기"),
    (42, 43, "소비자 피해보상 안내"),
    (44, 44, "품질 보증서"),
    (45, 45, "고객만족 서비스"),
    (47, 47, "반품 및 교환 / 브랜드 정보"),
]

# 표 레이아웃 때문에 텍스트 추출 순서가 뒤섞이는 페이지는 사람이 정리한 텍스트로 대체
OVERRIDES = {
    10: """미닉스 더 플렌더 맥스 제품 사양
- 제품명: 미닉스 더 플렌더 맥스 (The Flender)
- 모델명: MNFD-200*, 200**
- 정격전압: 220V / 60Hz
- 소비전력: 0.9kW
- 처리방식: 건조분쇄식 (복합건조식)
- 처리가능 중량: 3L(3kg)
- 감량률: 80% 내외
- 설치방식: 프리스탠딩 방식 (독립형)
- 탈취방식: 복합탈취필터
- 중량: 9.3kg
- 규격: W 195 × D 422 × H 341mm
- 제조원: (주) 앳홈플렌테크
- 판매원: (주) 앳홈
- 고객센터(A/S): 1800-6307
※ 제품 특성상 제조 과정에서 일부 오차가 발생할 수 있습니다.""",
    19: """❶ 분리배출 여부 확인 (투입하면 안 되는 것)
음식물 쓰레기로 분류되는 종류만 투입하고, 사람과 동물이 먹을 수 없는 것(무기물)은 음식물이 아닙니다. 아래 항목은 기기에 넣지 말고 일반 쓰레기로 분리배출해 주세요.
- 채소류: 쪽파, 대파, 미나리 등의 뿌리 / 고추씨, 고춧대, 양파, 마늘, 생강, 옥수수 등의 껍질 / 옥수수대
- 과일류: 호두, 밤, 땅콩, 도토리 등 딱딱한 껍데기 / 복숭아, 살구, 감 등 핵과류의 씨 / 과일의 줄기, 꼭지
- 곡류: 왕겨 (벼의 겉 겨)
- 육류: 소, 돼지, 닭 등의 털과 뼈다귀
- 어패류: 조개, 소라, 전복, 멍게, 굴 등의 껍데기 / 게, 가재 등 갑각류의 껍데기 / 굵은 생선 뼈
- 기타: 계란 등 알껍데기 / 각종 차류, 한약재 찌꺼기 / 병뚜껑, 나무젓가락 등 이물질
※ 이스트(효모) 성분이 포함된 식품 또는 발효가 진행되는 음식물은 고온으로 인해 팽창 또는 파열(폭발) 위험이 있어 투입을 권장하지 않습니다.
❷ 투입 전 주의사항
분류상 음식물 쓰레기이나 한 가지 종류만 다량으로 처리할 경우 음식물이 뭉쳐진 형태로 굳거나 제품에 손상을 입힐 수 있습니다.
- 단단한 섬유질 (바나나 껍질, 열무김치, 양배추, 옥수수 심 등): 동작하면서 엉키지 않게 적당한 크기로 잘라주세요.
- 달라붙는 음식물 (밥, 우동, 떡, 감자전 분류, 당분류(과일청, 초콜렛, 사탕 등)): 다른 음식물과 혼합해서 넣어주세요.
- 기름기 많은 음식물 (고기류 비계, 튀김, 껍데기 등): 다른 음식물과 혼합해서 넣어주세요.
- 연체동물류 (생물 혹은 마른 오징어, 문어, 낙지 등): 적당한 크기로 잘라 다른 음식물과 혼합해서 넣어주세요.
※ 음식물을 과투입할 경우 작동 중 넘칠 수 있으며, 이로 인한 기기 오염 또는 기능 이상은 과실에 따라 무상 보증 적용이 제한될 수 있습니다. 한계선 이내로 투입해 주세요.
※ 기름이 많은 음식물 또는 기름 자체는 고온 건조 중 끓어넘칠 수 있어 1차적으로 기름 제거 후 투입해 주세요.""",
    42: """더 플렌더 맥스를 이용 중 불편을 겪으셨다면 아래와 같은 보상 서비스를 받을 수 있습니다.
❶ 무상 서비스 - 정상적인 사용 중 발생한 성능 및 기능상의 문제로 고장이 발생하는 경우 (피해 유형: 보상 내용)
- 구매 후 10일 이내 중요한 수리 발생: 제품 교환 또는 구입가 환불
- 구매 후 1개월 이내 중요한 수리 발생: 제품 교환 또는 무상 수리
- 구매 후 운송과정에서 발생한 피해: 제품 교환
- 교환된 제품이 1개월 이내 중요한 수리 발생: 구입가 환불
- 무상 보증기간 이내 하자 발생: 무상 수리
- (보증기간 내) 수리 불가능의 경우: 제품 교환 또는 구입가 환불
- (보증기간 내) 교환 불가능의 경우: 구입가 환불
- 동일 하자로 2회 수리 후 동일 증상 발생의 경우: 제품 교환 또는 구입가 환불
- 서로 다른 하자로 4회 수리 후 불량 증상 발생의 경우: 제품 교환 또는 구입가 환불
- 소비자가 수리 의뢰한 제품을 분실한 경우: 제품 교환 또는 구입가 환불
- 부품 보유기간 내 수리용 부품을 보유하지 않아 발생한 피해: 제품 교환 또는 구입가 환불
소비자 고의 및 과실에 의한 고장인 경우
- 수리 가능한 경우: 유상 수리
- 수리 불가능한 경우: 유상 수리에 해당하는 금액 징수 후 제품 교환""",
}

MARKER = re.compile(r"^[❶-❿⓫-⓴]")
MIN_CHARS, MAX_CHARS = 120, 700


def section_of(page: int) -> str:
    for start, end, title in SECTIONS:
        if start <= page <= end:
            return title
    return "기타"


def clean(text: str, page: int) -> list[str]:
    lines = [ln.strip() for ln in text.splitlines()]
    out: list[str] = []
    pending_note = False
    for ln in lines:
        if not ln or ln == str(page) or re.fullmatch(r"\d{2}\.?", ln):
            continue
        if ln == "*":  # 다음 줄이 주석(※)임을 뜻하는 기호
            pending_note = True
            continue
        if pending_note:
            ln = "※ " + ln
            pending_note = False
            out.append(ln)
            continue
        # PDF 줄바꿈으로 끊긴 문장 이어 붙이기 (긴 줄이 문장 끝으로 끝나지 않았고, 새 항목이 아닐 때)
        if out and len(out[-1]) > 25 and not re.search(r"[.!?:)요다]$", out[-1]) \
                and not MARKER.match(ln) and not ln.startswith(("·", "-", "※", "Check")):
            out[-1] += " " + ln
        else:
            out.append(re.sub(r"^·\s+", "· ", ln))
    return out


def split_blocks(lines: list[str]) -> list[str]:
    """❶❷… 번호 항목 단위로 나눈 뒤, 너무 짧은 조각은 합치고 긴 조각은 자름."""
    blocks: list[list[str]] = [[]]
    for ln in lines:
        if MARKER.match(ln) and blocks[-1]:
            blocks.append([])
        blocks[-1].append(ln)
    texts = ["\n".join(b) for b in blocks if b]

    merged: list[str] = []
    for t in texts:
        if merged and (len(merged[-1]) < MIN_CHARS or len(t) < MIN_CHARS) \
                and len(merged[-1]) + len(t) <= MAX_CHARS:
            merged[-1] += "\n" + t
        else:
            merged.append(t)

    final: list[str] = []
    for t in merged:
        while len(t) > MAX_CHARS:
            cut = t.rfind("\n", 0, MAX_CHARS)
            cut = cut if cut > MIN_CHARS else MAX_CHARS
            final.append(t[:cut].strip())
            t = t[cut:].strip()
        if t:
            final.append(t)
    return final


def main() -> None:
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    reader = PdfReader(str(pdf))
    chunks = []
    for i, page in enumerate(reader.pages, start=1):
        if i in SKIP_PAGES:
            continue
        raw = OVERRIDES.get(i) or page.extract_text() or ""
        lines = clean(raw, i) if i not in OVERRIDES else raw.splitlines()
        for text in split_blocks(lines):
            chunks.append({"id": len(chunks), "page": i, "section": section_of(i), "text": text})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"title": "미닉스 더 플렌더 맥스 (MNFD-200G) 사용 설명서",
                               "chunks": chunks}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(chunks)}개 조각 생성 -> {OUT}")


if __name__ == "__main__":
    main()
