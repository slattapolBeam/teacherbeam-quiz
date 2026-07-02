export interface ExamSet {
  title: string
  codeTemplate: string
  answers: string[]
}

export interface ExamDatabase {
  [projectName: string]: {
    [setKey: string]: ExamSet
  }
}

export const allExamsDatabase: ExamDatabase = {
  "ExpenseNote": {
    set_1: {
      title: "ชุดที่ 1: เติมคำสั่งเกี่ยวกับ Activity และ Validation เบื้องต้น",
      codeTemplate: `class MainActivity : <input type="text" class="code-input" style="width: 150px;" id="q0"><button class="hint-btn" onclick="useHint(0)">💡</button>() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val tvTotal = findViewById&lt;<input type="text" class="code-input" style="width: 100px;" id="q1"><button class="hint-btn" onclick="useHint(1)">💡</button>&gt;(R.id.tvTotal)
        <input type="text" class="code-input" style="width: 60px;" id="q2"><button class="hint-btn" onclick="useHint(2)">💡</button> total: Double = 0.0

        btnAdd.setOnClickListener {
            val amountText = etAmount.<input type="text" class="code-input" style="width: 60px;" id="q3"><button class="hint-btn" onclick="useHint(3)">💡</button>.toString().trim()
            
            if (amountText.isEmpty()) {
                <input type="text" class="code-input" style="width: 80px;" id="q4"><button class="hint-btn" onclick="useHint(4)">💡</button>.makeText(this, "ว่าง", Toast.LENGTH_SHORT).show()
                return@setOnClickListener 
            }

            val amount = amountText.<input type="text" class="code-input" style="width: 150px;" id="q5"><button class="hint-btn" onclick="useHint(5)">💡</button>()
            if (amount != null) {
                total <input type="text" class="code-input" style="width: 50px;" id="q6"><button class="hint-btn" onclick="useHint(6)">💡</button> amount
                val showNote = if (noteText.<input type="text" class="code-input" style="width: 120px;" id="q7"><button class="hint-btn" onclick="useHint(7)">💡</button>()) noteText else "ไม่ระบุ"
                
                tvTotal.text = "ยอดรวม: %.2f".<input type="text" class="code-input" style="width: 80px;" id="q8"><button class="hint-btn" onclick="useHint(8)">💡</button>(total)
                etAmount.text.<input type="text" class="code-input" style="width: 80px;" id="q9"><button class="hint-btn" onclick="useHint(9)">💡</button>()
            }
        }
    }
}`,
      answers: ["AppCompatActivity", "TextView", "var", "text", "Toast", "toDoubleOrNull", "+=", "isNotEmpty", "format", "clear"]
    },
    set_2: {
      title: "ชุดที่ 2: เติมคำสั่งการตรวจสอบเงื่อนไขยอดเงิน",
      codeTemplate: `class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        <input type="text" class="code-input" style="width: 150px;" id="q0"><button class="hint-btn" onclick="useHint(0)">💡</button>(R.layout.activity_main)

        var total: <input type="text" class="code-input" style="width: 90px;" id="q1"><button class="hint-btn" onclick="useHint(1)">💡</button> = 0.0

        btnAdd.setOnClickListener {
            val amountText = etAmount.text.toString().<input type="text" class="code-input" style="width: 80px;" id="q2"><button class="hint-btn" onclick="useHint(2)">💡</button>()
            if (amountText.isEmpty()) {
                <input type="text" class="code-input" style="width: 220px;" id="q3"><button class="hint-btn" onclick="useHint(3)">💡</button>
            }

            val amount = amountText.toDoubleOrNull()
            if (amount <input type="text" class="code-input" style="width: 80px;" id="q4"><button class="hint-btn" onclick="useHint(4)">💡</button>) {
                total += amount
                val showNote = if (noteText.<input type="text" class="code-input" style="width: 120px;" id="q5"><button class="hint-btn" onclick="useHint(5)">💡</button>()) noteText <input type="text" class="code-input" style="width: 60px;" id="q6"><button class="hint-btn" onclick="useHint(6)">💡</button> "ไม่ระบุ"
                tvTotal.<input type="text" class="code-input" style="width: 70px;" id="q7"><button class="hint-btn" onclick="useHint(7)">💡</button> = "ยอดรวม: %.2f".format(total)
            }
        }
        btnClear.setOnClickListener {
            total = <input type="text" class="code-input" style="width: 60px;" id="q8"><button class="hint-btn" onclick="useHint(8)">💡</button>
            etAmount.<input type="text" class="code-input" style="width: 120px;" id="q9"><button class="hint-btn" onclick="useHint(9)">💡</button>()
        }
    }`,
      answers: ["setContentView", "Double", "trim", "return@setOnClickListener", "!=null", "isNotEmpty", "else", "text", "0.0", "text.clear"]
    },
    set_3: {
      title: "ชุดที่ 3: เติมคำสั่งการดึงข้อมูลและการแปลงชนิดตัวแปร",
      codeTemplate: `class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: <input type="text" class="code-input" style="width: 80px;" id="q0"><button class="hint-btn" onclick="useHint(0)">💡</button>?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val etAmount = findViewById&lt;<input type="text" class="code-input" style="width: 100px;" id="q1"><button class="hint-btn" onclick="useHint(1)">💡</button>&gt;(R.id.etAmount)
        var total: Double = 0.0

        btnClear.<input type="text" class="code-input" style="width: 180px;" id="q2"><button class="hint-btn" onclick="useHint(2)">💡</button> {
            total = 0.0
            etAmount.text.clear()
        }

        btnAdd.setOnClickListener {
            val amountText = etAmount.text.toString().<input type="text" class="code-input" style="width: 80px;" id="q3"><button class="hint-btn" onclick="useHint(3)">💡</button>()
            if (amountText.isEmpty()) <input type="text" class="code-input" style="width: 220px;" id="q4"><button class="hint-btn" onclick="useHint(4)">💡</button>

            val amount = amountText.<input type="text" class="code-input" style="width: 150px;" id="q5"><button class="hint-btn" onclick="useHint(5)">💡</button>()
            if (amount != null) {
                total <input type="text" class="code-input" style="width: 50px;" id="q6"><button class="hint-btn" onclick="useHint(6)">💡</button> amount
                tvLastItem.<input type="text" class="code-input" style="width: 70px;" id="q7"><button class="hint-btn" onclick="useHint(7)">💡</button> = "รายการล่าสุด: %.2f".<input type="text" class="code-input" style="width: 80px;" id="q8"><button class="hint-btn" onclick="useHint(8)">💡</button>(amount)
                etAmount.text.<input type="text" class="code-input" style="width: 80px;" id="q9"><button class="hint-btn" onclick="useHint(9)">💡</button>()
            }
        }
    }`,
      answers: ["Bundle", "EditText", "setOnClickListener", "trim", "return@setOnClickListener", "toDoubleOrNull", "+=", "text", "format", "clear"]
    },
    set_4: {
      title: "ชุดที่ 4: เติมคำสั่งการตรวจสอบค่า Null และการกำหนด View",
      codeTemplate: `class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(<input type="text" class="code-input" style="width: 100px;" id="q0"><button class="hint-btn" onclick="useHint(0)">💡</button>.activity_main)

        val btnAdd = findViewById&lt;<input type="text" class="code-input" style="width: 80px;" id="q1"><button class="hint-btn" onclick="useHint(1)">💡</button>&gt;(R.id.btnAdd)
        <input type="text" class="code-input" style="width: 60px;" id="q2"><button class="hint-btn" onclick="useHint(2)">💡</button> total: Double = 0.0

        btnAdd.setOnClickListener {
            val amountText = etAmount.text.<input type="text" class="code-input" style="width: 100px;" id="q3"><button class="hint-btn" onclick="useHint(3)">💡</button>().trim()
            if (amountText.<input type="text" class="code-input" style="width: 100px;" id="q4"><button class="hint-btn" onclick="useHint(4)">💡</button>()) return@setOnClickListener 

            val amount = amountText.toDoubleOrNull()
            if (amount == <input type="text" class="code-input" style="width: 60px;" id="q5"><button class="hint-btn" onclick="useHint(5)">💡</button>) return@setOnClickListener
            
            <input type="text" class="code-input" style="width: 70px;" id="q6"><button class="hint-btn" onclick="useHint(6)">💡</button> += amount
            val showNote = if (noteText.isNotEmpty()) noteText <input type="text" class="code-input" style="width: 60px;" id="q7"><button class="hint-btn" onclick="useHint(7)">💡</button> "ไม่ระบุ"
            
            tvTotal.text = "ยอดรวมวันนี้: %.2f บาท".format(total)
        }
        btnClear.setOnClickListener {
            total = <input type="text" class="code-input" style="width: 60px;" id="q8"><button class="hint-btn" onclick="useHint(8)">💡</button>
            etAmount.<input type="text" class="code-input" style="width: 120px;" id="q9"><button class="hint-btn" onclick="useHint(9)">💡</button>()
        }
    }`,
      answers: ["R.layout", "Button", "var", "toString", "isEmpty", "null", "total", "else", "0.0", "text.clear"]
    }
  }
}