/**
 * Standalone ISO/IEC 18004 Standard QR Code Generator for WhatsApp Pairing
 * Zero-dependency pure TypeScript implementation based on Kazuhiko Arase's QR algorithm.
 * Generates true 2D matrix modules & valid scalable vector graphics (SVG) scanable by camera.
 */

const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] =
    EXP_TABLE[i - 4] ^
    EXP_TABLE[i - 5] ^
    EXP_TABLE[i - 6] ^
    EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) {
  LOG_TABLE[EXP_TABLE[i]] = i;
}

function glog(n: number): number {
  if (n < 1) throw new Error("glog(" + n + ")");
  return LOG_TABLE[n];
}

function gexp(n: number): number {
  while (n < 0) n += 255;
  while (n >= 256) n -= 255;
  return EXP_TABLE[n];
}

class QRPolynomial {
  readonly num: number[];

  constructor(num: number[], shift = 0) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift).fill(0);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const res = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        res[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new QRPolynomial(res);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = [...this.num];
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num).mod(e);
  }
}

const RS_BLOCK_TABLE: number[][] = [
  // Version 1-10 (L, M, Q, H)
  // 1
  [1, 26, 19],
  [1, 26, 16],
  [1, 26, 13],
  [1, 26, 9],
  // 2
  [1, 44, 34],
  [1, 44, 28],
  [1, 44, 22],
  [1, 44, 16],
  // 3
  [1, 70, 55],
  [1, 70, 44],
  [2, 35, 17],
  [2, 35, 13],
  // 4
  [1, 100, 80],
  [2, 50, 32],
  [2, 50, 24],
  [4, 25, 9],
  // 5
  [1, 134, 108],
  [2, 67, 43],
  [2, 33, 15, 2, 34, 16],
  [2, 33, 11, 2, 34, 12],
  // 6
  [2, 86, 68],
  [4, 43, 27],
  [4, 43, 19],
  [4, 43, 15],
  // 7
  [2, 98, 78],
  [4, 49, 31],
  [2, 32, 14, 4, 33, 15],
  [4, 39, 13, 1, 40, 14],
  // 8
  [2, 121, 97],
  [2, 60, 38, 2, 61, 39],
  [4, 40, 18, 2, 41, 19],
  [4, 43, 14, 2, 44, 15],
  // 9
  [2, 146, 116],
  [3, 58, 36, 2, 59, 37],
  [4, 36, 16, 4, 37, 17],
  [4, 36, 12, 4, 37, 13],
  // 10
  [2, 86, 68, 2, 87, 69],
  [4, 69, 43, 1, 70, 44],
  [6, 43, 19, 2, 44, 20],
  [6, 43, 15, 2, 44, 16],
];

interface RSBlock {
  totalCount: number;
  dataCount: number;
}

function getRSBlocks(typeNumber: number, errorCorrectionLevel: number): RSBlock[] {
  const row = RS_BLOCK_TABLE[(typeNumber - 1) * 4 + errorCorrectionLevel];
  if (!row) throw new Error("Unsupported QR version: " + typeNumber);
  const blocks: RSBlock[] = [];
  const length = row.length / 3;
  for (let i = 0; i < length; i++) {
    const count = row[i * 3 + 0];
    const totalCount = row[i * 3 + 1];
    const dataCount = row[i * 3 + 2];
    for (let j = 0; j < count; j++) {
      blocks.push({ totalCount, dataCount });
    }
  }
  return blocks;
}

const PATTERN_POSITION_TABLE: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHDigit(data: number): number {
  let digit = 0;
  while (data !== 0) {
    digit++;
    data >>>= 1;
  }
  return digit;
}

function getBCHTypeInfo(data: number): number {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
    d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

function getErrorCorrectPolynomial(errorCorrectLength: number): QRPolynomial {
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++) {
    a = a.multiply(new QRPolynomial([1, gexp(i)], 0));
  }
  return a;
}

function getMask(maskPattern: number, i: number, j: number): boolean {
  switch (maskPattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return false;
  }
}

class BitBuffer {
  buffer: number[] = [];
  length = 0;

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

/**
 * Encodes text into an authentic QR code 2D boolean grid (true = dark module, false = light module)
 */
export function generateQRMatrix(
  text: string,
  minTypeNumber = 4,
  errorCorrectionLevel = 1, // 0 = L, 1 = M, 2 = Q, 3 = H
): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  // Auto-detect version needed
  let typeNumber = minTypeNumber;
  for (let t = minTypeNumber; t <= 10; t++) {
    const rs = getRSBlocks(t, errorCorrectionLevel);
    let totalData = 0;
    for (const b of rs) totalData += b.dataCount;
    // 8-bit byte mode overhead: 4 bits mode + (t < 10 ? 8 : 16) bits length
    const overhead = 4 + (t < 10 ? 8 : 16);
    if (bytes.length * 8 + overhead <= totalData * 8) {
      typeNumber = t;
      break;
    }
  }

  const rsBlocks = getRSBlocks(typeNumber, errorCorrectionLevel);
  const buffer = new BitBuffer();

  // Mode: 8-bit byte (0100)
  buffer.put(0x04, 4);
  buffer.put(bytes.length, typeNumber < 10 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) {
    buffer.put(bytes[i], 8);
  }

  let totalDataCount = 0;
  for (const b of rsBlocks) totalDataCount += b.dataCount;

  // Terminator
  if (buffer.length + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }
  // Pad bits to byte boundary
  while (buffer.length % 8 !== 0) {
    buffer.putBit(false);
  }
  // Pad bytes
  while (buffer.length < totalDataCount * 8) {
    buffer.put(0xec, 8);
    if (buffer.length < totalDataCount * 8) {
      buffer.put(0x11, 8);
    }
  }

  // Create blocks with error correction
  const dcData: number[][] = [];
  const ecData: number[][] = [];
  let offset = 0;

  for (let r = 0; r < rsBlocks.length; r++) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].totalCount - dcCount;

    const blockDc: number[] = [];
    for (let i = 0; i < dcCount; i++) {
      blockDc.push(0xff & buffer.buffer[i + offset]);
    }
    offset += dcCount;
    dcData.push(blockDc);

    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(blockDc, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);

    const blockEc = new Array(rsPoly.getLength() - 1).fill(0);
    for (let i = 0; i < blockEc.length; i++) {
      const modIndex = i + modPoly.getLength() - blockEc.length;
      blockEc[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
    ecData.push(blockEc);
  }

  // Interleave data and EC bytes
  const finalData: number[] = [];
  let maxDcCount = 0;
  let maxEcCount = 0;
  for (const b of rsBlocks) {
    maxDcCount = Math.max(maxDcCount, b.dataCount);
    maxEcCount = Math.max(maxEcCount, b.totalCount - b.dataCount);
  }

  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < dcData[r].length) {
        finalData.push(dcData[r][i]);
      }
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < ecData[r].length) {
        finalData.push(ecData[r][i]);
      }
    }
  }

  // Matrix construction
  const moduleCount = typeNumber * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: moduleCount }, () =>
    new Array(moduleCount).fill(null),
  );

  // 1. Finder patterns
  function setupFinderPattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          modules[row + r][col + c] = true;
        } else {
          modules[row + r][col + c] = false;
        }
      }
    }
  }

  setupFinderPattern(0, 0);
  setupFinderPattern(0, moduleCount - 7);
  setupFinderPattern(moduleCount - 7, 0);

  // 2. Alignment patterns
  const positions = PATTERN_POSITION_TABLE[typeNumber - 1] || [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const row = positions[i];
      const col = positions[j];
      if (modules[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          if (
            r === -2 ||
            r === 2 ||
            c === -2 ||
            c === 2 ||
            (r === 0 && c === 0)
          ) {
            modules[row + r][col + c] = true;
          } else {
            modules[row + r][col + c] = false;
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let r = 8; r < moduleCount - 8; r++) {
    if (modules[r][6] === null) modules[r][6] = r % 2 === 0;
  }
  for (let c = 8; c < moduleCount - 8; c++) {
    if (modules[6][c] === null) modules[6][c] = c % 2 === 0;
  }

  // 4. Dark module
  modules[4 * typeNumber + 9][8] = true;

  // 5. Format info area reservations
  for (let i = 0; i < 8; i++) {
    if (modules[8][i] === null) modules[8][i] = false;
    if (modules[8][moduleCount - i - 1] === null)
      modules[8][moduleCount - i - 1] = false;
    if (modules[i][8] === null) modules[i][8] = false;
    if (modules[moduleCount - i - 1][8] === null)
      modules[moduleCount - i - 1][8] = false;
  }
  modules[8][8] = false;

  // 6. Data payload bits placement
  const dataBits = new BitBuffer();
  for (const b of finalData) {
    dataBits.put(b, 8);
  }

  const maskPattern = 0; // standard checker mask
  let bitIndex = 0;
  let inc = -1;
  let rowIdx = moduleCount - 1;

  for (let rightCol = moduleCount - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // skip vertical timing column
    while (true) {
      for (let c = 0; c < 2; c++) {
        const col = rightCol - c;
        if (modules[rowIdx][col] === null) {
          let dark = false;
          if (bitIndex < dataBits.length) {
            dark = dataBits.get(bitIndex);
          }
          bitIndex++;
          const mask = getMask(maskPattern, rowIdx, col);
          modules[rowIdx][col] = mask ? !dark : dark;
        }
      }
      rowIdx += inc;
      if (rowIdx < 0 || moduleCount <= rowIdx) {
        rowIdx -= inc;
        inc = -inc;
        break;
      }
    }
  }

  // 7. Write Format bits
  const formatData = getBCHTypeInfo((errorCorrectionLevel << 3) | maskPattern);
  for (let i = 0; i < 15; i++) {
    const mod = ((formatData >>> i) & 1) === 1;
    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[moduleCount - 15 + i][8] = mod;
    }

    if (i < 8) {
      modules[8][moduleCount - i - 1] = mod;
    } else if (i < 9) {
      modules[8][15 - i - 1 + 1] = mod;
    } else {
      modules[8][15 - i - 1] = mod;
    }
  }

  return modules.map((row) => row.map((cell) => cell === true));
}

/**
 * Generates an SVG string representation of a valid QR code
 */
export function generateQRSvg(text: string, size = 260, margin = 2): string {
  const matrix = generateQRMatrix(text);
  const n = matrix.length;
  const viewSize = n + margin * 2;

  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="#0b382c"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${size}" height="${size}" shape-rendering="crispEdges">
    <rect width="100%" height="100%" fill="#ffffff"/>
    ${rects}
  </svg>`;
}
