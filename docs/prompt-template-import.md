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

---

## ส่วนขยาย 1: ข้อสอบหลายไฟล์ (`files`)

ถ้าโจทย์ต้องใช้หลายไฟล์พร้อมกัน (เช่น `build.gradle.kts` + `libs.versions.toml` ของโปรเจกต์ Android) ให้ใช้ `files` แทน `code`:

```json
{
  "title": "...",
  "files": [
    { "filename": "build.gradle.kts", "code": "...___..." },
    { "filename": "libs.versions.toml", "code": "...___..." }
  ],
  "answers": [...]
}
```

- ใช้ `code` **หรือ** `files` อย่างใดอย่างหนึ่งต่อชุด ห้ามใส่พร้อมกัน
- เลข `___` นับ**ต่อเนื่องข้ามไฟล์**ตามลำดับที่ไฟล์ปรากฏใน array — ไม่รีเซ็ตเป็น 0 ใหม่ทุกไฟล์ (ไฟล์แรกอาจจบที่ `___` ตัวที่ 5 ไฟล์ที่สองก็เริ่มนับต่อจากตัวที่ 6 เป็นต้นไป) ต้องเรียง `answers` ให้ตรงกับลำดับนี้เป๊ะ
- หน้าสอบจะแสดงเป็นแท็บให้นักศึกษาสลับไปมาระหว่างไฟล์

## ส่วนขยาย 2: ช่องแบบ dropdown (`blanks`)

ถ้าอยากให้บางช่องเป็นตัวเลือก dropdown แทนการเติมคำอิสระ ให้เพิ่ม `blanks` array (ทางเลือก) ขนานกับ `answers` — ตำแหน่งเดียวกัน จำนวนเท่ากัน ช่องไหนไม่ใช่ dropdown ให้ใส่ `null`:

```json
{
  "title": "...",
  "code": "...var total: ___ = 0.0...",
  "answers": ["Double", "for", ...],
  "blanks": [
    { "type": "dropdown", "choices": ["Double", "Int", "String", "Float"] },
    null,
    ...
  ]
}
```

- เฉลยใน `answers` ที่ตำแหน่งนั้นต้องอยู่ใน `choices` ด้วยเสมอ ไม่งั้นระบบจะ error ตอนตรวจสอบ
- ช่อง dropdown จะไม่มีปุ่มคำใบ้ 💡 (เผยแค่บางส่วนไม่มีประโยชน์เมื่อมีตัวเลือกให้ไม่กี่อัน) แต่ยังใช้ Super Token 🌟 เพื่อให้ระบบเลือกคำตอบที่ถูกให้ได้เหมือนเดิม
- ใช้ร่วมกับ `files` ได้ — `blanks` เป็น array เดียวสำหรับทั้งชุด ไม่แยกตามไฟล์

## Prompt สำหรับข้อสอบหลายไฟล์ + dropdown (จากซอร์สโค้ดจริง)

ใช้ prompt นี้แทนอันแรก เมื่ออยากอิงข้อสอบจากโปรเจกต์จริงของนักศึกษา (เช่นไฟล์ Gradle/Android หลายไฟล์) และ/หรืออยากให้บางช่องเป็น dropdown:

```
สร้างข้อสอบเติมโค้ดวิชา [ชื่อวิชา] เรื่อง [หัวข้อ] จำนวน [N] ชุด จากซอร์สโค้ดจริงด้านล่างนี้:

[วางซอร์สโค้ดของโปรเจกต์จริงตรงนี้ ถ้ามีหลายไฟล์ให้ระบุชื่อไฟล์แต่ละไฟล์ให้ชัดเจน]

กติกา:
- ถ้าโจทย์ต้องใช้มากกว่า 1 ไฟล์พร้อมกัน ให้ใช้ "files" (array ของ {filename, code}) แทน "code" เดี่ยว ๆ
- ใช้ ___ (ขีดเส้นใต้ 3 ตัว) แทนช่องว่างที่ให้เติม เรียงจากบนลงล่าง นับต่อเนื่องข้ามไฟล์ (ไม่รีเซ็ตเป็น 0 ทุกไฟล์) ให้ตรงกับลำดับใน answers
- ถ้าช่องไหนเหมาะจะเป็นตัวเลือก dropdown แทนเติมคำอิสระ (เช่น เลือกประเภทข้อมูล หรือเลือกชื่อจากตัวเลือกที่คล้ายกัน) ให้เพิ่ม "blanks" array ขนานกับ answers ตำแหน่งเดียวกัน จำนวนเท่ากัน — ช่องไหนไม่ใช่ dropdown ใส่ null, ช่องไหนเป็น dropdown ใส่ {"type":"dropdown","choices":[...]} โดยเฉลยใน answers ตำแหน่งนั้นต้องอยู่ใน choices ด้วยเสมอ ถ้าชุดนั้นไม่มี dropdown เลยไม่ต้องใส่ key "blanks" มา
- แต่ละชุดถามแนวคิดเดียวกัน แต่เปลี่ยนค่า/รายละเอียดให้ต่างกันเล็กน้อยกันก็อปข้ามชุด
- คำตอบเป็นคีย์เวิร์ด/คำสั่งสั้น ๆ ไม่ใช่ประโยค

ตอบเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบายเพิ่ม:
{
  "project_name": "...",
  "sets": {
    "set_1": {
      "title": "...",
      "files": [ { "filename": "...", "code": "..." }, ... ],
      "answers": [...],
      "blanks": [...]
    }
  }
}
```

## ตัวอย่างรวมทั้งสองแบบ

```json
{
  "project_name": "FirebaseBasic",
  "sets": {
    "set_1": {
      "title": "ชุดที่ 1: ตั้งค่า Firebase Realtime Database",
      "files": [
        {
          "filename": "libs.versions.toml",
          "code": "[libraries]\nfirebase-bom = { group = \"com.google.firebase\", name = \"firebase-bom\", version.ref = \"firebaseBom\" }\nfirebase-database-ktx = { group = \"com.google.firebase\", name = \"___\" }"
        },
        {
          "filename": "build.gradle.kts",
          "code": "dependencies {\n    implementation(platform(libs.firebase.bom))\n    implementation(libs.firebase.database.___)\n}"
        }
      ],
      "answers": ["firebase-database-ktx", "ktx"],
      "blanks": [
        null,
        { "type": "dropdown", "choices": ["ktx", "core", "runtime"] }
      ]
    }
  }
}
```

ที่นี่ `___` ตัวแรกอยู่ใน `libs.versions.toml` (index 0, เติมคำอิสระ) และ `___` ตัวที่สองอยู่ใน `build.gradle.kts` (index 1, เป็น dropdown) — เลขนับต่อเนื่องข้ามไฟล์ตามที่อธิบายไว้ด้านบน
