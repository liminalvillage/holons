#!/usr/bin/env bash
RPC="http://127.0.0.1:8545"

# ——— your deploy log pasted here ———
read -r -d '' DEPLOY_LOG <<'EOF'
Parent bundle contracts created successfully: {
  splitter: 0x3F2b1451574200d25318bfFD2C7c68a10bAA4256
  managed: '0xB9D512FAF432Ce6A0e09b1f2B195856F9E5EE822',
  zoned: '0xA95b108827C8F8CF981e605Fb2A18730b9Dae41c'
}
Child bundle contracts created successfully: {
  splitter: 0xf8E857B7d8B1e368E965Fb8CbDaE2d90AbADdB23
  managed: '0x88d58A1119745866c8B70144dB83d13D2ae23501',
  zoned: '0x96fCfc4b217D0eA9340807AB842dd7fF0537dBaB'
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
