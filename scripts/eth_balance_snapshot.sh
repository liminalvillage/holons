#!/usr/bin/env bash
RPC="http://127.0.0.1:8545"

# ——— your deploy log pasted here ———
read -r -d '' DEPLOY_LOG <<'EOF'
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

# extract addresses in order
mapfile -t addresses < <(grep -oE '0x[a-fA-F0-9]{40}' <<<"$DEPLOY_LOG")

# matching names
names=(
  parent_splitter
  parent_managed
  parent_zoned
  child_splitter
  child_managed
  child_zoned
)

echo "Snapshot @ block $(cast block-number --rpc-url $RPC)"
printf "%-16s %-42s %18s wei   %12s ETH\n" "NAME" "ADDRESS" "BALANCE" "ETH"
echo "--------------------------------------------------------------------------------"

for i in "${!addresses[@]}"; do
  name=${names[i]}
  addr=${addresses[i]}

  # 1) get the raw wei
  bal_wei=$(cast balance "$addr" --rpc-url "$RPC")
  # 2) convert wei → ether
  bal_eth=$(cast from-wei "$bal_wei" ether)

  printf "%-16s %-42s %18s wei   %12s ETH\n" \
    "$name" "$addr" "$bal_wei" "$bal_eth"
done
