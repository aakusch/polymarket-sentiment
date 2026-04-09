#!/bin/bash
# Run pipeline for all sectors + reference prices
cd "$(dirname "$0")"
for sector in crypto stocks economy politics; do
  echo "=== $sector ==="
  python3 snapshot.py --sector "$sector" -v 2>&1 | tail -5
  python3 export.py --sector "$sector" --out ../public/data -v 2>&1 | tail -3
done
echo "=== prices ==="
python3 prices.py 2>&1 | tail -3
echo "Done."
