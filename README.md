# 🧑‍💻 Coding Quiz Portal

ระบบข้อสอบเขียนโค้ดออนไลน์สำหรับใช้สอนในห้องเรียน — นักศึกษาเข้าสอบด้วยรหัส PIN แล้วเติมโค้ดให้สมบูรณ์ อาจารย์ควบคุมห้องสอบและดูคะแนนแบบเรียลไทม์ผ่าน Dashboard

---

## 📋 สารบัญ

- [ฟีเจอร์หลัก](#-ฟีเจอร์หลัก)
- [Tech Stack](#-tech-stack)
- [โครงสร้างโปรเจกต์](#-โครงสร้างโปรเจกต์)
- [เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน)
- [Database Schema](#-database-schema)
- [สถานะโปรเจกต์](#-สถานะโปรเจกต์)

---

## ✨ ฟีเจอร์หลัก

### สำหรับนักศึกษา
- 🔑 เข้าสู่ระบบด้วยรหัสนักศึกษา → เลือกวิชา → กรอกรหัส PIN
- 📝 ทำข้อสอบแบบเติมโค้ดให้สมบูรณ์ พร้อมจับเวลา
- 💾 บันทึกคำตอบอัตโนมัติลง localStorage ระหว่างทำ — ไม่หายแม้เผลอรีเฟรช (Draft Autosave)
- 💡 ระบบคำใบ้ (จำกัด 3 ครั้งต่อคน) และ 🌟 Super Token (เติมคำตอบให้ทันที)
- 📚 โหมดทบทวนเฉลย — เข้าดูได้อัตโนมัติหลังอาจารย์ปิดห้องสอบ โดยไม่ต้องใช้ PIN ซ้ำ
- 🎁 รับ Super Token แบบสุ่มจากอาจารย์ระหว่างคาบเรียน (Mystery Drop popup แบบเรียลไทม์)

### สำหรับอาจารย์
- 🔐 ล็อกอินด้วย email/password ผ่าน Supabase Auth — สร้างบัญชีได้จาก Supabase Dashboard เท่านั้น
- 👨‍🏫 Dashboard ควบคุมห้องสอบ — เปิด/ปิด PIN, ดูคะแนนแบบเรียลไทม์
- 📊 สรุปคะแนนเฉลี่ย/สูงสุด/ต่ำสุด พร้อม filter ตามห้องเรียน
- 🌟 แจก Super Token ได้ทั้งแบบสุ่ม (Gacha ผ่าน modal ในแอป) และแจกรายคน
- 🔄 รีเซ็ต Super Token แยกตามห้องเรียนได้อิสระ ไม่กระทบห้องอื่น
- 🗑️ ลบผลสอบรายคนเพื่อให้สอบใหม่ได้
- 📥 ดาวน์โหลดคะแนนเป็น CSV
- 📤 Import ข้อสอบจาก JSON โดยตรง พร้อม prompt template สำหรับสร้างข้อสอบผ่าน Claude
- 📋 Audit Log บันทึกทุก action ของอาจารย์ (เปิด/ปิดห้อง, แจก token, ลบผล, import) พร้อม timestamp

---

## 🛠️ Tech Stack

| ส่วนประกอบ | เทคโนโลยีที่ใช้ |
|---|---|
| Framework | Next.js 16 (App Router) |
| ภาษา | TypeScript |
| Styling | Tailwind CSS v4 |
| ฐานข้อมูล | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password สำหรับอาจารย์) |
| Session | httpOnly Cookie (iron-session) |
| Realtime | Supabase Realtime (Broadcast + postgres_changes) |
| ฟอนต์ | Prompt (Google Fonts, รองรับภาษาไทย) |

---

## 📁 โครงสร้างโปรเจกต์

```
teacherbeam-quiz/
├── app/
│   ├── page.tsx              # หน้า Login รวม (เลือกบทบาท → เลือกวิชา → PIN)
│   ├── exam/page.tsx         # ห้องสอบ / โหมดทบทวนเฉลย
│   ├── dashboard/page.tsx    # Dashboard อาจารย์
│   └── import/page.tsx       # หน้า Import ข้อสอบจาก JSON
├── app/actions/              # Next.js Server Actions (ทุก write ผ่านที่นี่)
│   ├── auth.ts               # signInTeacher, signOutTeacher, requireTeacher
│   ├── dashboard.ts          # ควบคุมห้องสอบ, token, ลบผล, ดาวน์โหลด CSV
│   ├── exam.ts               # submit คำตอบ, ใช้ hint/token
│   ├── import.ts             # import ข้อสอบจาก JSON
│   └── session.ts            # จัดการ student session cookie
├── lib/
│   ├── auditLog.ts           # บันทึก audit log ทุก mutating action
│   ├── session.ts            # iron-session config
│   └── supabase/             # Supabase clients (browser, server, auth)
├── docs/
│   └── prompt-template-import.md  # Prompt template สำหรับสร้างข้อสอบผ่าน Claude
└── types/
    └── exam.ts               # TypeScript types หลักของระบบ
```

---

## 🚀 เริ่มต้นใช้งาน

### ติดตั้ง dependencies

```bash
npm install
```

### ตั้งค่า Environment Variables

สร้างไฟล์ `.env.local` ที่ root ของโปรเจกต์:

```env
NEXT_PUBLIC_SUPABASE_URL=<URL โปรเจกต์ Supabase ของคุณ>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Anon/Publishable Key>
SUPABASE_SERVICE_ROLE_KEY=<Service Role Key — ใช้เฉพาะฝั่ง server>
SESSION_SECRET=<random string ยาวอย่างน้อย 32 ตัวอักษร>
```

> ⚠️ **สำคัญ:** `SUPABASE_SERVICE_ROLE_KEY` ต้องเป็น service role key จริง (bypass RLS ได้) ไม่ใช่ anon key — คนละตัวกัน

### รัน development server

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) เพื่อดูผลลัพธ์

### คำสั่งอื่น ๆ ที่ใช้บ่อย

```bash
npm run build   # build สำหรับ production
npm run start   # รัน production server
npm run lint    # ตรวจสอบ code style
```

---

## 🗄️ Database Schema

ระบบใช้ Supabase (PostgreSQL) มีตารางหลักดังนี้:

```
students        → student_id, first_name, last_name, room, class_number, super_tokens
exam_sessions   → id, project_name, pin_code, is_active, created_at
exam_results    → id, student_id, project_name, exam_set, score, hints_used,
                   student_answers, submitted_at, created_at
subjects        → id, name, description, is_active, created_at
exam_questions  → id, project_name, set_name, question_order, type, question,
                   code, answers, hint, created_at
activity_logs   → id, actor_type, actor_id, action, metadata, created_at
```

> ⚠️ RLS (Row Level Security) เปิดแบบ public read/insert สำหรับ internal use เท่านั้น ยังไม่เหมาะกับการเปิดสู่สาธารณะ

---

## 📌 สถานะโปรเจกต์

| เฟส | รายละเอียด | สถานะ |
|---|---|---|
| Phase 0 | Setup โครงสร้าง Next.js + ตารางฐานข้อมูลใหม่ | ✅ เสร็จแล้ว |
| Phase 1 | ย้าย UI แบบ 1:1 (Login, ห้องสอบ, Dashboard) | ✅ เสร็จแล้ว |
| Phase 2 | ระบบ Login รวม + เลือกวิชา + animate role toggle | ✅ เสร็จแล้ว |
| Phase 3 | ดึงข้อสอบจาก Database แทนการ hardcode | ✅ เสร็จแล้ว |
| Phase 4 | หน้า Import ข้อสอบจาก JSON + prompt template | ✅ เสร็จแล้ว |
| Phase 5 | Security Overhaul (Server Actions + httpOnly cookie) | ✅ เสร็จแล้ว |
| Phase 6 | ระบบยืนยันตัวตนอาจารย์ (Supabase Auth) | ✅ เสร็จแล้ว |
| Phase 7.1 | Draft autosave คำตอบลง localStorage | ✅ เสร็จแล้ว |
| Phase 7.2 | ซ่อนเฉลยฝั่ง server (ไม่ส่ง answers ไปยัง client ขณะสอบ) | ✅ เสร็จแล้ว |
| Phase 7.3 | Audit Log บันทึกทุก mutating action ของอาจารย์ | ✅ เสร็จแล้ว |

---

*โปรเจกต์นี้พัฒนาร่วมกับ Claude Code*
