"""身份证号解析：出生日期、性别、年龄、省级代码、校验位。"""
from __future__ import annotations

from datetime import date

# 前 2 位省级代码（GB/T 2260）
PROVINCE_CODES = {
    "11": "北京", "12": "天津", "13": "河北", "14": "山西", "15": "内蒙古",
    "21": "辽宁", "22": "吉林", "23": "黑龙江",
    "31": "上海", "32": "江苏", "33": "浙江", "34": "安徽", "35": "福建",
    "36": "江西", "37": "山东",
    "41": "河南", "42": "湖北", "43": "湖南", "44": "广东", "45": "广西",
    "46": "海南",
    "50": "重庆", "51": "四川", "52": "贵州", "53": "云南", "54": "西藏",
    "61": "陕西", "62": "甘肃", "63": "青海", "64": "宁夏", "65": "新疆",
}

_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
_CHECK_CODES = "10X98765432"


def checksum_valid(id_number: str) -> bool:
    if not id_number or len(id_number) != 18:
        return False
    body = id_number[:17]
    if not body.isdigit():
        return False
    total = sum(int(body[i]) * _WEIGHTS[i] for i in range(17))
    return _CHECK_CODES[total % 11] == id_number[17].upper()


def parse_id(id_number: str, today: date | None = None) -> dict:
    """身份证 -> {birthDate, gender, age, province, valid}。"""
    result = {"birthDate": "", "gender": "", "age": "", "province": "", "valid": False}
    if not id_number or len(id_number) != 18:
        return result
    body = id_number[:17]
    if not body.isdigit():
        return result
    result["valid"] = checksum_valid(id_number)
    result["province"] = PROVINCE_CODES.get(id_number[:2], "")
    y, m, d = int(body[6:10]), int(body[10:12]), int(body[12:14])
    if 1900 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31:
        result["birthDate"] = f"{y}-{m:02d}-{d:02d}"
        today = today or date.today()
        age = today.year - y - ((today.month, today.day) < (m, d))
        if 0 < age < 100:
            result["age"] = str(age)
    result["gender"] = "男" if int(body[16]) % 2 == 1 else "女"
    return result
