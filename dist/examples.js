// Each example is a standalone source file that can be compiled and run in the IDE.
export const advancedExamples = [
  {
    name: 'Fibonacci · memoization',
    filename: 'fibonacci.pseudo',
    code: `// Recursive Fibonacci with an array cache.
DECLARE Memo : ARRAY[0:20] OF INTEGER

FUNCTION Fibonacci(N : INTEGER) RETURNS INTEGER
  IF N < 2 THEN
    RETURN N
  ENDIF
  IF Memo[N] <> 0 THEN
    RETURN Memo[N]
  ENDIF
  Memo[N] ← Fibonacci(N - 1) + Fibonacci(N - 2)
  RETURN Memo[N]
ENDFUNCTION

DECLARE Index : INTEGER
OUTPUT "First 21 Fibonacci numbers"
FOR Index ← 0 TO 20
  OUTPUT "F(", Index, ") = ", Fibonacci(Index)
NEXT Index
`,
  },
  {
    name: 'N queens · backtracking',
    filename: 'n-queens.pseudo',
    code: `// Change N to try other board sizes; N = 8 has 92 solutions.
CONSTANT N = 8
DECLARE Queens : ARRAY[1:N] OF INTEGER
DECLARE UsedColumn : ARRAY[1:N] OF BOOLEAN
DECLARE UsedDown : ARRAY[1:2 * N - 1] OF BOOLEAN
DECLARE UsedUp : ARRAY[1:2 * N - 1] OF BOOLEAN
DECLARE Solutions : INTEGER

PROCEDURE PrintBoard()
  DECLARE Row : INTEGER
  DECLARE Column : INTEGER
  DECLARE Line : STRING
  OUTPUT "First solution:"
  FOR Row ← 1 TO N
    Line ← ""
    FOR Column ← 1 TO N
      IF Queens[Row] = Column THEN
        Line ← Line & "Q "
      ELSE
        Line ← Line & ". "
      ENDIF
    NEXT Column
    OUTPUT Line
  NEXT Row
ENDPROCEDURE

PROCEDURE Search(Row : INTEGER)
  DECLARE Column : INTEGER
  DECLARE Down : INTEGER
  DECLARE Up : INTEGER
  FOR Column ← 1 TO N
    Down ← Row + Column - 1
    Up ← Row - Column + N
    IF NOT UsedColumn[Column] AND NOT UsedDown[Down] AND NOT UsedUp[Up] THEN
      Queens[Row] ← Column
      UsedColumn[Column] ← TRUE
      UsedDown[Down] ← TRUE
      UsedUp[Up] ← TRUE
      IF Row = N THEN
        Solutions ← Solutions + 1
        IF Solutions = 1 THEN
          CALL PrintBoard()
        ENDIF
      ELSE
        CALL Search(Row + 1)
      ENDIF
      UsedColumn[Column] ← FALSE
      UsedDown[Down] ← FALSE
      UsedUp[Up] ← FALSE
    ENDIF
  NEXT Column
ENDPROCEDURE

CALL Search(1)
OUTPUT "Solutions: ", Solutions
`,
  },
  {
    name: 'ASCII Minesweeper',
    filename: 'ascii-minesweeper.pseudo',
    code: `// Five-by-five Minesweeper. Use R to reveal, F to flag, Q to quit.
// INPUT pauses in the terminal. Enter one value at each prompt.
CONSTANT SIZE = 5
CONSTANT MINE_COUNT = 5
DECLARE Mines : ARRAY[1:5, 1:5] OF BOOLEAN
DECLARE Revealed : ARRAY[1:5, 1:5] OF BOOLEAN
DECLARE Flagged : ARRAY[1:5, 1:5] OF BOOLEAN
DECLARE Nearby : ARRAY[1:5, 1:5] OF INTEGER
DECLARE SafeLeft : INTEGER
DECLARE Placed : INTEGER
DECLARE Row : INTEGER
DECLARE Column : INTEGER
DECLARE DR : INTEGER
DECLARE DC : INTEGER
DECLARE NR : INTEGER
DECLARE NC : INTEGER
DECLARE Action : STRING
DECLARE Finished : BOOLEAN

PROCEDURE ShowBoard()
  DECLARE R : INTEGER
  DECLARE C : INTEGER
  DECLARE Line : STRING
  OUTPUT "  1 2 3 4 5"
  FOR R ← 1 TO SIZE
    Line ← NUM_TO_STR(R) & " "
    FOR C ← 1 TO SIZE
      IF Revealed[R, C] THEN
        IF Mines[R, C] THEN
          Line ← Line & "* "
        ELSE
          IF Nearby[R, C] = 0 THEN
            Line ← Line & ". "
          ELSE
            Line ← Line & NUM_TO_STR(Nearby[R, C]) & " "
          ENDIF
        ENDIF
      ELSE
        IF Flagged[R, C] THEN
          Line ← Line & "F "
        ELSE
          Line ← Line & "# "
        ENDIF
      ENDIF
    NEXT C
    OUTPUT Line
  NEXT R
ENDPROCEDURE

PROCEDURE Reveal(R : INTEGER, C : INTEGER)
  DECLARE DeltaRow : INTEGER
  DECLARE DeltaColumn : INTEGER
  IF R < 1 OR R > SIZE OR C < 1 OR C > SIZE THEN
    RETURN
  ENDIF
  IF Revealed[R, C] OR Flagged[R, C] OR Mines[R, C] THEN
    RETURN
  ENDIF
  Revealed[R, C] ← TRUE
  SafeLeft ← SafeLeft - 1
  IF Nearby[R, C] = 0 THEN
    FOR DeltaRow ← -1 TO 1
      FOR DeltaColumn ← -1 TO 1
        IF DeltaRow <> 0 OR DeltaColumn <> 0 THEN
          CALL Reveal(R + DeltaRow, C + DeltaColumn)
        ENDIF
      NEXT DeltaColumn
    NEXT DeltaRow
  ENDIF
ENDPROCEDURE

SafeLeft ← SIZE * SIZE - MINE_COUNT
WHILE Placed < MINE_COUNT
  Row ← INT(RAND() * SIZE) + 1
  Column ← INT(RAND() * SIZE) + 1
  IF NOT Mines[Row, Column] THEN
    Mines[Row, Column] ← TRUE
    Placed ← Placed + 1
  ENDIF
ENDWHILE

FOR Row ← 1 TO SIZE
  FOR Column ← 1 TO SIZE
    IF Mines[Row, Column] THEN
      FOR DR ← -1 TO 1
        FOR DC ← -1 TO 1
          NR ← Row + DR
          NC ← Column + DC
          IF NR >= 1 AND NR <= SIZE AND NC >= 1 AND NC <= SIZE THEN
            Nearby[NR, NC] ← Nearby[NR, NC] + 1
          ENDIF
        NEXT DC
      NEXT DR
    ENDIF
  NEXT Column
NEXT Row

OUTPUT "ASCII MINESWEEPER — 5 mines hidden"
WHILE NOT Finished
  CALL ShowBoard()
  OUTPUT "Action: R=reveal, F=flag, Q=quit"
  INPUT Action
  Action ← UCASE(Action)
  IF Action = "Q" THEN
    Finished ← TRUE
    OUTPUT "Game ended."
  ELSE
    IF Action = "R" OR Action = "F" THEN
      OUTPUT "Row (1-5)?"
      INPUT Row
      OUTPUT "Column (1-5)?"
      INPUT Column
      IF Row < 1 OR Row > SIZE OR Column < 1 OR Column > SIZE THEN
        OUTPUT "Coordinates must be from 1 to 5."
      ELSE
        IF Action = "F" THEN
          IF NOT Revealed[Row, Column] THEN
            Flagged[Row, Column] ← NOT Flagged[Row, Column]
          ENDIF
        ELSE
          IF Flagged[Row, Column] THEN
            OUTPUT "Remove the flag before revealing this square."
          ELSE
            IF Mines[Row, Column] THEN
              Finished ← TRUE
              OUTPUT "BOOM! You hit a mine."
            ELSE
              CALL Reveal(Row, Column)
              IF SafeLeft = 0 THEN
                Finished ← TRUE
                OUTPUT "You cleared every safe square!"
              ENDIF
            ENDIF
          ENDIF
        ENDIF
      ENDIF
    ELSE
      OUTPUT "Choose R, F, or Q."
    ENDIF
  ENDIF
ENDWHILE

FOR Row ← 1 TO SIZE
  FOR Column ← 1 TO SIZE
    IF Mines[Row, Column] THEN
      Revealed[Row, Column] ← TRUE
    ENDIF
  NEXT Column
NEXT Row
CALL ShowBoard()
`,
  },
];
