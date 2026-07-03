# Prompt Template สำหรับ Generate ข้อสอบด้วย Claude

> ใช้ prompt นี้กับ Claude เพื่อเจนข้อสอบเติมโค้ด แล้วนำ JSON ที่ได้ไปวางในหน้า Import (`/import`) ของระบบ
>
> รูปแบบนี้ตรงกับวิธีที่ตาราง `exam_questions` เก็บข้อมูลจริง (1 แถว = 1 ชุดข้อสอบทั้งชุด ไม่ใช่ 1 แถวต่อ 1 คำถาม) — อย่าใช้ JSON format แบบอื่นที่ไม่ตรงกับนี้

---

## Prompt ที่ใช้กับ Claude

```
สร้างข้อสอบเติมโค้ด (fill-in-the-blank) วิชา [ชื่อวิชา] เรื่อง [หัวข้อ] จำนวน 4 ชุด (set_1 - set_4)

กติกา:
- แต่ละชุดถามแนวคิดเดียวกัน แต่เปลี่ยนค่าตัวแปร/รายละเอียดให้ต่างกันเล็กน้อย กันก็อปข้ามชุด
- เขียนเป็นโปรแกรมสมบูรณ์ 1 ไฟล์ ใช้ ___ (ขีดเส้นใต้ 3 ตัว) แทนช่องว่างที่ให้เติม
- เรียง ___ จากบนลงล่างให้ตรงกับลำดับใน answers
- แต่ละชุดมีช่องว่างประมาณ 8-10 ช่อง คำตอบเป็นคีย์เวิร์ด/คำสั่งสั้น ๆ ไม่ใช่ประโยค

ตอบเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบายเพิ่ม:
{
  "project_name": "...",
  "sets": {
    "set_1": { "title": "...", "code": "...", "answers": [...] },
    "set_2": { ... }, "set_3": { ... }, "set_4": { ... }
  }
}
```

## ตัวอย่างผลลัพธ์ที่ Claude เจนกลับมา

```json
{
  "project_name": "KotlinArrayLoop",
  "sets": {
    "set_1": {
      "title": "ชุดที่ 1: คำนวณคะแนนเฉลี่ยและหาคะแนนสูงสุด",
      "code": "fun main() {\n    val scores = ___(80, 92, 75, 68, 90)\n    var total = 0\n\n    ___ (score in scores) {\n        total += score\n    }\n\n    val average = total.___() / scores.size\n    println(\"คะแนนเฉลี่ย: $average\")\n\n    val maxScore = scores.___()\n    println(\"คะแนนสูงสุด: $maxScore\")\n\n    if (maxScore ___ 90) {\n        println(\"เก่งมาก!\")\n    }\n}",
      "answers": ["arrayOf", "for", "toDouble", "max", ">="]
    },
    "set_2": {
      "title": "ชุดที่ 2: คำนวณยอดขายรวมและหายอดขายต่ำสุด",
      "code": "fun main() {\n    val sales = ___(1500, 2200, 900, 3100, 1800)\n    var total = 0\n\n    ___ (amount in sales) {\n        total += amount\n    }\n\n    val average = total.___() / sales.size\n    println(\"ยอดขายเฉลี่ย: $average\")\n\n    val minSale = sales.___()\n    println(\"ยอดขายต่ำสุด: $minSale\")\n\n    if (minSale ___ 1000) {\n        println(\"ต้องกระตุ้นยอดขาย\")\n    }\n}",
      "answers": ["arrayOf", "for", "toDouble", "min", "<"]
    }
  }
}
```

`set_3` และ `set_4` ตามแพทเทิร์นเดียวกัน แค่เปลี่ยนโจทย์/ค่าอีกรอบ

---

## กติกาสำคัญที่หน้า Import ต้องตรวจสอบ

- จำนวน `___` ในแต่ละ `code` ต้องตรงกับความยาวของ `answers` array ของชุดนั้นพอดี — ถ้าไม่ตรงต้องแจ้ง error ก่อนบันทึก ห้าม insert ข้อมูลที่ไม่ตรงกัน
- `___` แต่ละตัวจะถูกแปลงเป็น `<input type="text" class="code-input" id="qN"><button class="hint-btn" onclick="useHint(N)">💡</button>` ตามลำดับที่เจอในโค้ด (เริ่มจาก `q0`)
- อาจารย์/Claude ไม่ต้องยุ่งกับ HTML `<input>` เอง — หน้า Import เป็นคนแปลงให้ทั้งหมด
