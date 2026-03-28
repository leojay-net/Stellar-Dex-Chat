import re, pathlib

f = pathlib.Path('/Users/mac/Desktop/CODE/stellar-dex-chat/stellar-contracts/src/test.rs')
src = f.read_text()

original = src

# --- Fix 1: single-line deposit/try_deposit calls with , &0, &0) ---
src = re.sub(r',\s*&0,\s*&0\)', ', &0, &0, &None)', src)

# --- Fix 2: multiline try_deposit ending with &max_slippage,\n    ); ---
src = re.sub(
    r'(\n\s+&max_slippage,\n)(\s+\);)',
    r'\1        &None,\n\2',
    src
)

# --- Fix 3: multiline deposit ending with &600,\n    ); ---
src = re.sub(
    r'(\n\s+&600,\n)(\s+\);)',
    r'\1        &None,\n\2',
    src
)

# --- Fix 4: request_withdrawal with 3 user args ---
src = re.sub(
    r'(\.request_withdrawal\(&\w+,\s*&\d+,\s*&\w+)\)',
    r'\1, &None)',
    src
)

# --- Fix 5: try_request_withdrawal with 3 user args ---
src = re.sub(
    r'(\.try_request_withdrawal\(&\w+,\s*&\d+,\s*&\w+)\)',
    r'\1, &None)',
    src
)

changes = sum(1 for a, b in zip(original.splitlines(), src.splitlines()) if a != b)
print(f'Changed {changes} lines')
f.write_text(src)
print('Written successfully')
