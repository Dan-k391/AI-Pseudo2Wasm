static double used_column[12], used_down[24], used_up[24];
static double queen_solutions;

static void place_queen(int row, int n) {
  for (int column = 0; column < n; column++) {
    int down = row + column;
    int up = row - column + n - 1;
    if (!used_column[column] && !used_down[down] && !used_up[up]) {
      used_column[column] = used_down[down] = used_up[up] = 1;
      if (row + 1 == n) queen_solutions++;
      else place_queen(row + 1, n);
      used_column[column] = used_down[down] = used_up[up] = 0;
    }
  }
}

double nQueens(int n) {
  queen_solutions = 0;
  for (int i = 0; i < n; i++) used_column[i] = 0;
  for (int i = 0; i < 2 * n - 1; i++) used_down[i] = used_up[i] = 0;
  place_queen(0, n);
  return queen_solutions;
}

static double composite[100000];

double primeCount(int limit) {
  for (int i = 0; i < limit; i++) composite[i] = 0;
  double count = 0;
  for (int i = 2; i < limit; i++) {
    if (!composite[i]) {
      count++;
      int j = i + i;
      while (j < limit) {
        composite[j] = 1;
        j += i;
      }
    }
  }
  return count;
}

static double matrix_a[48][48], matrix_b[48][48], matrix_c[48][48];

double matMul(int n) {
  for (int i = 0; i < n; i++) {
    for (int j = 0; j < n; j++) {
      matrix_a[i][j] = (i + j) % 7;
      matrix_b[i][j] = (i * 2 + j) % 11;
      matrix_c[i][j] = 0;
    }
  }
  for (int i = 0; i < n; i++) {
    for (int j = 0; j < n; j++) {
      double total = 0;
      for (int k = 0; k < n; k++) total += matrix_a[i][k] * matrix_b[k][j];
      matrix_c[i][j] = total;
    }
  }
  double checksum = 0;
  for (int i = 0; i < n; i++) checksum += matrix_c[i][i];
  return checksum;
}
