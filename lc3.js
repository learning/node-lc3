const fs = require('fs')
let step = 0

// 内存大小: 65536 个 16bit
const MEMORY_SIZE = 65536
const PC_START = 0x3000 // 默认的起始执行位置

// 初始化内存, 因为 Node.js 的 Buffer 单位是 byte
// 16bit 就是 2 个 byte
const memory = Buffer.alloc(MEMORY_SIZE * 2)

// 寄存器列表 (Registers)
const R_R0 = 0
const R_R1 = 1
const R_R2 = 2
const R_R3 = 3
const R_R4 = 4
const R_R5 = 5
const R_R6 = 6
const R_R7 = 7
const R_PC = 8 /* program counter */
const R_COND = 9

// 初始化寄存器，每个都是 16bit
const reg = [
  Buffer.alloc(2), // R0
  Buffer.alloc(2), // R1
  Buffer.alloc(2), // R2
  Buffer.alloc(2), // R3
  Buffer.alloc(2), // R4
  Buffer.alloc(2), // R5
  Buffer.alloc(2), // R6
  Buffer.alloc(2), // R7
  Buffer.alloc(2), // PC
  Buffer.alloc(2), // COND
]

// 内存映射寄存器 (Memory Mapped Registers)
const MR_KBSR = 0xFE00 // 键盘状态
const MR_KBDR = 0xFE00 // 键盘数据

// 指令集 (Opcodes)
const OP_BR   = 0b0000 /* branch */
const OP_ADD  = 0b0001 /* add  */
const OP_LD   = 0b0010 /* load */
const OP_ST   = 0b0011 /* store */
const OP_JSR  = 0b0100 /* jump register */
const OP_AND  = 0b0101 /* bitwise and */
const OP_LDR  = 0b0110 /* load register */
const OP_STR  = 0b0111 /* store register */
const OP_RTI  = 0b1000 /* unused */
const OP_NOT  = 0b1001 /* bitwise not */
const OP_LDI  = 0b1010 /* load indirect */
const OP_STI  = 0b1011 /* store indirect */
const OP_JMP  = 0b1100 /* jump */
const OP_RES  = 0b1101 /* reserved (unused) */
const OP_LEA  = 0b1110 /* load effective address */
const OP_TRAP = 0b1111 /* execute trap */

// 条件标记 (Condition Flags)
const FL_POS = 1 << 0 // P
const FL_ZRO = 1 << 1 // Z
const FL_NEG = 1 << 2 // N

// 陷阱指令 (Trap codes)
const TRAP_GETC  = 0x20 /* get character from keyboard */
const TRAP_OUT   = 0x21 /* output a character */
const TRAP_PUTS  = 0x22 /* output a word string */
const TRAP_IN    = 0x23 /* input a string */
const TRAP_PUTSP = 0x24 /* output a byte string */
const TRAP_HALT  = 0x25 /* halt the program */

function getChar() {
  return new Promise(resolve => {
    process.stdin.once('data', buf => {
      if (buf[0] === 3) process.exit()
      resolve(buf[0])
    })
  })
}

function disableInputBuffering() {
  process.stdin.setRawMode(true)
}

function restoreInputBuffering() {
  process.stdin.setRawMode(false)
}

function handleInterrupt(signal) {
  console.log('handleInterrupt', signal)
  restoreInputBuffering()
  console.log('')
  process.exit(-2)
}

function checkKey() {
  console.log('checkKey: not implement yet.')
}

function memWrite(address, val) {
  try {
    memory.writeUInt16BE(val & 0xffff, address * 2)
  } catch (e) {
    console.log('[Error](memWrite)', e)
  }
}

function memRead(address) {
  if (address === MR_KBSR) {
    if (checkKey()) {
      consonle.log('checkKey: not implement yet.')
      memWrite(MR_KBSR, 1 << 15)
      // memWrite(MR_KBDR, await getChar())
    } else {
      memWrite(MR_KBSR, 0)
    }
  }
  return memory.readUInt16BE(address * 2)
}

function signExtend(x, bitCount) {
  if ((x >> (bitCount - 1)) & 1) {
    // js 是32位数字
    x = (0xFFFFFFFF << bitCount) | x
  }
  return x
}

function updateFlags(r) {
  if (reg[r].readUInt16BE() === 0) {
    reg[R_COND].writeUInt16BE(FL_ZRO & 0xffff)
  } else if (reg[r].readUInt16BE() >> 15) { // 最左位是 1, 即负数
    reg[R_COND].writeUInt16BE(FL_NEG & 0xffff)
  } else {
    reg[R_COND].writeUInt16BE(FL_POS & 0xffff)
  }
}

function readImage(path) {
  console.log('load image: ', path)
  try {
    const img = fs.readFileSync(path, {
      flag: 'r'
    })
    // 第一个 16bit, 是一个地址，要将镜像放在内存中的什么位置
    // Node.js 不需要转换，都给转好了，默认大端模式 (big-endian)
    // C 语言则要转，Intel 都是小端模式 (little-endian)
    // 因为 0x3000 读出来是 0x0030
    let origin = img.readUInt16BE(0)

    // 将镜像拷贝到内存中的 origin 位置
    img.copy(memory, origin * 2, 2)
    return true
  } catch (e) {
    console.warn(e)
    return false
  }
}

// 开始运行
if (process.argv.length < 3) {
  console.info("用法: node lc3.js [image-file]")
  process.exit(2)
}

if (!readImage(process.argv[2])) {
  console.warn(`加载镜像文件失败：${process.argv[2]}`)
  process.exit(1)
}

process.stdin.resume()
process.on('SIGINT', handleInterrupt)
disableInputBuffering()

// 把PC寄存器设置成起始位置
reg[R_PC].writeUInt16BE(PC_START & 0xffff)

let running = true

// 陷阱指令，取代 switch-case
const traps = {
  [TRAP_GETC]: instr => new Promise(resolve => {
    getChar().then(c => {
      reg[R_R0].writeUInt16BE(c & 0xffff)
      resolve()
    })
  }),
  [TRAP_OUT]: instr => new Promise(resolve => {
    process.stdout.write(reg[R_R0])
    resolve()
  }),
  [TRAP_PUTS]: instr => new Promise(resolve => {
    let address = reg[R_R0].readUInt16BE()
    let c = memRead(address++)
    while (c) {
      process.stdout.write(Buffer.from([c & 0xff]))
      c = memRead(address++)
    }
    resolve()
  }),
  [TRAP_IN]: instr => new Promise(resolve => {
    process.stdout.write("Please Enter A Character: ")
    getChar().then(c => {
      process.stdout.write(c + "\n")
      reg[R_R0].writeUInt16BE(c & 0xffff)
      resolve()
    })
  }),
  [TRAP_PUTSP]: instr => new Promise(resolve => {
    let address = reg[R_R0].readUInt16BE()
    let dc = memRead(address++)
    while (dc) {
      const lc = dc & 0xff
      const hc = dc >> 0xf
      process.stdout.write(lc)
      hc && process.stdout.write(hc)
      dc = memRead(address++)
    }
    resolve()
  }),
  [TRAP_HALT]: instr => new Promise(resolve => {
    process.stdout.write("HALT")
    running = false
    resolve()
  })
}

// 指令操作，取代 switch-case 用
const operations = [
  // OP_BR
  instr => new Promise(resolve => {
    const flag = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)

    if (flag & reg[R_COND].readUInt16BE()) {
      reg[R_PC].writeUInt16BE(
        (reg[R_PC].readUInt16BE() + offset) & 0xffff
      )
    }
    resolve()
  }),

  // OP_ADD
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const r1 = (instr >> 6) & 0x7
    const flag = (instr >> 5) & 0x1

    if (flag) {
      const imm5 = signExtend(instr & 0x1f, 5)
      reg[r0].writeUInt16BE(
        (reg[r1].readUInt16BE() + imm5) & 0xffff
      )
    } else {
      const r2 = instr & 0x7
      reg[r0].writeUInt16BE(
        (reg[r1].readUInt16BE() + reg[r2].readUInt16BE()) & 0xffff
      )
    }

    updateFlags(r0)
    resolve()
  }),

  // OP_LD
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)
    reg[r0].writeUInt16BE(
      memRead(reg[R_PC].readUInt16BE() + offset) & 0xffff
    )
    updateFlags(r0)
    resolve()
  }),

  // OP_ST
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)
    memWrite(reg[R_PC].readUInt16BE() + offset, reg[r0].readUInt16BE())
    resolve()
  }),

  // OP_JSR
  instr => new Promise(resolve => {
    const flag = (instr >> 11) & 1

    reg[R_R7].writeUInt16BE(
      reg[R_PC].readUInt16BE() & 0xffff
    )
    if (flag) {
      const offset = signExtend(instr & 0x7ff, 11)
      reg[R_PC].writeUInt16BE(
        (reg[R_PC].readUInt16BE() + offset) & 0xffff
      )
    } else {
      const r0 = (instr >> 6) & 0x7
      reg[R_PC].writeUInt16BE(
        reg[r0].readUInt16BE() & 0xffff
      )
    }
    resolve()
  }),

  // OP_AND
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const r1 = (instr >> 6) & 0x7
    const flag = (instr >> 5) & 0x1

    if (flag) {
      const imm5 = signExtend(instr & 0x1f, 5)
      reg[r0].writeUInt16BE(
        (reg[r1].readUInt16BE() & imm5) & 0xffff
      )
    } else {
      const r2 = instr & 0x7
      reg[r0].writeUInt16BE(
        (reg[r1].readUInt16BE() & reg[r2].readUInt16BE()) & 0xffff
      )
    }
    updateFlags(r0)
    resolve()
  }),

  // OP_LDR
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const r1 = (instr >> 6) & 0x7
    const offset = signExtend(instr & 0x3f, 6)
    reg[r0].writeUInt16BE(
      memRead(reg[r1].readUInt16BE() + offset) & 0xffff
    )
    updateFlags(r0)
    resolve()
  }),

  // OP_STR
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const r1 = (instr >> 6) & 0x7
    const offset = signExtend(instr & 0x3f, 6)
    memWrite(reg[r1].readUInt16BE() + offset, reg[r0].readUInt16BE())
    resolve()
  }),

  // OP_RTI
  () => Promise.resolve(process.abort()),

  // OP_NOT
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const r1 = (instr >> 6) & 0x7

    // js 是 32 位的 ~
    reg[r0].writeUInt16BE(
      (~(reg[r1].readUInt16BE())) & 0xffff
    )
    updateFlags(r0);
    resolve()
  }),

  // OP_LDI
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)
    reg[r0].writeUInt16BE(
      memRead(
        memRead(
          (reg[R_PC].readUInt16BE() + offset) & 0xffff
        )
      )
    )
    updateFlags(r0)
    resolve()
  }),

  // OP_STI
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)
    memWrite(memRead(reg[R_PC].readUInt16BE() + offset), reg[r0].readUInt16BE())
    resolve()
  }),

  // OP_JMP
  instr => new Promise(resolve => {
    const r0 = (instr >> 6) & 0x7
    reg[R_PC].writeUInt16BE(
      reg[r0].readUInt16BE() & 0xffff
    )
    resolve()
  }),

  // OP_RES
  () => Promise.resolve(process.abort()),

  // OP_LEA
  instr => new Promise(resolve => {
    const r0 = (instr >> 9) & 0x7
    const offset = signExtend(instr & 0x1ff, 9)
    reg[r0].writeUInt16BE(
      (reg[R_PC].readUInt16BE() + offset) & 0xffff
    )
    updateFlags(r0)
    resolve()
  }),

  // OP_TRAP
  instr => {
    const trap = traps[instr & 0xff]
    if (trap) {
      return trap(instr)
    } else {
      return Promise.resolve(true)
    }
  }
]

async function mainloop() {
  while (running) {
    const instr = memRead(reg[R_PC].readUInt16BE())
    reg[R_PC].writeUInt16BE(
      (reg[R_PC].readUInt16BE() + 1) & 0xffff
    )
    const op = instr >> 12
    const operation = operations[op]
    if (operation) {
      await operation(instr)
    } 
  }
  restoreInputBuffering()
  process.exit(0)
}

mainloop()
