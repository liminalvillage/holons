#!/usr/bin/env bash
set -euo pipefail

RPC="http://127.0.0.1:8545"
TOKEN="0x4b15ef62139852D91184D39EB85324D763cf35C9"  # your ERC-20 contract

# ── 1) autodetect token decimals (fallback to 18) ─────────────────────────────
DECIMALS=$(
  cast call "$TOKEN" "decimals()(uint8)" --rpc-url "$RPC" 2>/dev/null \
    | cut -d' ' -f1 \
    | xargs \
    || echo 18
)

# ── 2) paste your deploy log here ─────────────────────────────────────────────
DEPLOY_LOG=$(cat <<'EOF'
Parent bundle contracts created successfully: {
  splitter: 0x8Ac71F27F4f37a1b2CFC38dBFB8B4ad0a705212a
  managed: '0x517fD2b05377E817b443E77EF610922aC9C8bF38',
  zoned: '0x2BaB5000cd87db0FFcf59957Deeb7681391B29C4'
}
Child bundle contracts created successfully: {
  splitter: 0x47fcDC32CbF1c1D3B52D61E0343f36C17B58F255
  managed: '0x599a588594905d80a1F8662Efaed5fb1cDBA334c',
  zoned: '0xf6BADdEcc0d9878FC6769431c1D24cA9eEBcbBb6'
}
EOF
)

# ── 3) extract addresses & set up names ───────────────────────────────────────
mapfile -t addresses < <(grep -oE '0x[a-fA-F0-9]{40}' <<<"$DEPLOY_LOG")
names=(
  parent_splitter parent_managed parent_zoned
  child_splitter  child_managed  child_zoned
)

# ── 4) header ─────────────────────────────────────────────────────────────────
echo "ERC-20 snapshot (@ block $(cast block-number --rpc-url "$RPC"))"
printf "%-16s %-42s %22s ⇒  %s\n" "NAME" "ADDRESS" "RAW UNITS" "HUMAN"
echo "------------------------------------------------------------------------------------------------"

# ── 5) main loop ───────────────────────────────────────────────────────────────
for i in "${!addresses[@]}"; do
  name=${names[i]}
  addr=${addresses[i]}

  # a) get the raw output (decimal + “[1e…” annotation)
  raw_out=$(cast call "$TOKEN" \
    "balanceOf(address)(uint256)" \
    "$addr" \
    --rpc-url "$RPC")

  # b) strip the “[1e…]” — keep only the integer string
  raw_dec=$(echo "$raw_out" | cut -d' ' -f1 | xargs)

  # c) now build the human‐readable string by inserting the decimal point
  len=${#raw_dec}
  if [ "$len" -le "$DECIMALS" ]; then
    # pad with leading zeros so we can split at least 1 digit before the point
    pad_size=$((DECIMALS + 1 - len))
    zeros=$(printf "%0${pad_size}d" 0)
    raw_dec="${zeros}${raw_dec}"
    len=${#raw_dec}
  fi

  int_len=$((len - DECIMALS))
  integer_part=${raw_dec:0:int_len}
  fractional_part=${raw_dec:int_len}

  # drop trailing zeros in the fraction
  fractional_part=$(echo "$fractional_part" | sed -e 's/0*$//')

  if [ -n "$fractional_part" ]; then
    human="${integer_part}.${fractional_part}"
  else
    human="$integer_part"
  fi

  printf "%-16s %-42s %22s ⇒  %s\n" \
    "$name" "$addr" "$raw_dec" "$human"
done
