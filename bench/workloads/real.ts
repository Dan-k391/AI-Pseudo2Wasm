const usedColumn = new StaticArray<f64>(12);
const usedDown = new StaticArray<f64>(24);
const usedUp = new StaticArray<f64>(24);
let queenSolutions: f64 = 0;

function placeQueen(row: i32, n: i32): void {
  for (let column: i32 = 0; column < n; column++) {
    const down = row + column;
    const up = row - column + n - 1;
    if (!usedColumn[column] && !usedDown[down] && !usedUp[up]) {
      usedColumn[column] = usedDown[down] = usedUp[up] = 1;
      if (row + 1 == n) queenSolutions++;
      else placeQueen(row + 1, n);
      usedColumn[column] = usedDown[down] = usedUp[up] = 0;
    }
  }
}

export function nQueens(n: i32): f64 {
  queenSolutions = 0;
  for (let i: i32 = 0; i < n; i++) usedColumn[i] = 0;
  for (let i: i32 = 0; i < 2 * n - 1; i++) usedDown[i] = usedUp[i] = 0;
  placeQueen(0, n);
  return queenSolutions;
}

const composite = new StaticArray<f64>(100000);

export function primeCount(limit: i32): f64 {
  for (let i: i32 = 0; i < limit; i++) composite[i] = 0;
  let count: f64 = 0;
  for (let i: i32 = 2; i < limit; i++) {
    if (!composite[i]) {
      count++;
      let j: i32 = i + i;
      while (j < limit) {
        composite[j] = 1;
        j += i;
      }
    }
  }
  return count;
}

const matrixA = new StaticArray<f64>(48 * 48);
const matrixB = new StaticArray<f64>(48 * 48);
const matrixC = new StaticArray<f64>(48 * 48);

export function matMul(n: i32): f64 {
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j < n; j++) {
      matrixA[i * 48 + j] = (i + j) % 7;
      matrixB[i * 48 + j] = (i * 2 + j) % 11;
      matrixC[i * 48 + j] = 0;
    }
  }
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j < n; j++) {
      let total: f64 = 0;
      for (let k: i32 = 0; k < n; k++) total += matrixA[i * 48 + k] * matrixB[k * 48 + j];
      matrixC[i * 48 + j] = total;
    }
  }
  let checksum: f64 = 0;
  for (let i: i32 = 0; i < n; i++) checksum += matrixC[i * 48 + i];
  return checksum;
}
