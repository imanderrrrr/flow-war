#!/bin/zsh
# Paired, interleaved runs of the classroom harness: base (3e48515) vs gc (group commit branch).
# Both worktrees run byte-identical scripts/collaboration-classroom.ts and scripts/performance-probe.cjs.
# Seed 8, duration 1200, speed 20, 27/32 connections, DVR OFF/ON. Each run waits for 1-min load < 8.
S=${0:A:h:h}
OUT=${OUT:-$S/bench/results}; mkdir -p $OUT
LOG=$OUT/matrix.log
REPS=${REPS:-5}
FIRST=${FIRST:-1}
load1() { sysctl -n vm.loadavg | awk '{print $2}' }
waitload() { local waited=0; while true; do local l=$(load1); if (( l < 8 )); then echo "$l waited=${waited}s"; return; fi; sleep 15; waited=$((waited+15)); done }
for rep in $(seq $FIRST $REPS); do
  if (( rep % 2 == 1 )); then order=(base gc); else order=(gc base); fi
  for cfg in ${=CONFIGS:-27-off 32-off 27-on 32-on}; do
    students=$([[ $cfg == 27-* ]] && echo 25 || echo 30)
    dvr=${cfg#*-}
    for v in $order; do
      label=$v-$cfg-r$rep
      [[ -f $OUT/$label.json ]] && continue
      before=$(waitload)
      ( while true; do echo "$(date +%s) $(sysctl -n vm.loadavg)" >> $OUT/$label.load; sleep 5; done ) &
      sampler=$!
      start=$(date +%s)
      (cd $S/wt-$v && node --import tsx scripts/collaboration-classroom.ts --students=$students --duration=1200 --speed=20 --dvr=$dvr --label=$label --output-root=$OUT > $OUT/$label.stdout 2>&1 < /dev/null)
      code=$?
      kill $sampler 2>/dev/null; wait $sampler 2>/dev/null
      echo "$(date +%H:%M:%S) $label exit=$code secs=$(( $(date +%s) - start )) load_before=$before load_after=$(load1)" >> $LOG
    done
  done
done
echo "DONE $(date +%H:%M:%S)" >> $LOG
