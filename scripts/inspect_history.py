import csv

with open('results/sustained_steady_stats_history.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    rows = [row for row in r if row.get('Name') == 'Aggregated']

print(f"Total history entries: {len(rows)}")
step = max(1, len(rows) // 8)
print(f"{'Time':<8} | {'Users':<6} | {'RPS':<8} | {'p50':<8} | {'p90':<8} | {'p95':<8} | {'p99':<8} | {'Total Reqs':<10}")
print("-" * 75)
for idx in range(0, len(rows), step):
    row = rows[idx]
    rps = float(row.get('Requests/s', 0) or 0)
    p50 = row.get('50%')
    p90 = row.get('90%')
    p95 = row.get('95%')
    p99 = row.get('99%')
    u = row.get('User Count')
    tot = row.get('Total Request Count')
    sec = idx * 2  # Each history entry is sampled every ~2s
    print(f"{sec:3d}s     | {u:>5}  | {rps:6.1f}   | {p50:>6}ms | {p90:>6}ms | {p95:>6}ms | {p99:>6}ms | {tot:>10}")

if rows:
    last = rows[-1]
    rps = float(last.get('Requests/s', 0) or 0)
    print(f"180s     | {last.get('User Count'):>5}  | {rps:6.1f}   | {last.get('50%'):>6}ms | {last.get('90%'):>6}ms | {last.get('95%'):>6}ms | {last.get('99%'):>6}ms | {last.get('Total Request Count'):>10}")
