------------------------------- MODULE Edge -------------------------------
EXTENDS Naturals, FiniteSets, Sequences, TLC
CONSTANTS JobCount, WorkerCount, MaxAttempts, Mutation, KeepEvent
Jobs == 1..JobCount
Workers == 1..WorkerCount
Blocking == {"claimed", "executing", "uncertain"}
States == {"queued", "claimed", "executing", "succeeded", "failed",
           "uncertain", "cancelled", "expired"}
VARIABLE s
vars == <<s>>
Job == [state |-> "queued", attempt |-> 0, started |-> FALSE,
        resolved |-> FALSE, grants |-> 0, result |-> "none"]
Worker == [job |-> 0, attempt |-> 0, journal |-> "none", pc |-> "idle",
           reply |-> "none", result |-> "none", sends |-> 0, crashed |-> FALSE]
Init == s = [jobs |-> [j \in Jobs |-> Job], workers |-> [w \in Workers |-> Worker],
             claimSafe |-> TRUE, fenceSafe |-> TRUE, resolveSafe |-> TRUE,
             event |-> "Init"]
Name(op, id) == op \o ":" \o ToString(id)
Emit(next, event) == s' = [next EXCEPT !.event = IF KeepEvent THEN event ELSE ""]
Busy(j) == \E k \in Jobs \ {j}: s.jobs[k].state \in Blocking
Current(w) == s.workers[w].attempt = s.jobs[s.workers[w].job].attempt

\* Claims are bounded: each logical worker receives at most one claim.
\* Only claim delivery is atomic in this slice; start/result delivery is not.
Claim(w, j) ==
  /\ s.workers[w].pc = "idle"
  /\ s.jobs[j].state = "queued" /\ s.jobs[j].attempt < MaxAttempts
  /\ (Mutation = "claim" \/ ~Busy(j))
  /\ LET a == s.jobs[j].attempt + 1 IN
     Emit([s EXCEPT !.jobs[j].state = "claimed", !.jobs[j].attempt = a,
             !.workers[w] = [Worker EXCEPT !.job = j, !.attempt = a, !.pc = "claimed"],
             !.claimSafe = @ /\ ~Busy(j)], Name(Name("Claim", w), j))

PersistStarting(w) ==
  /\ s.workers[w].pc = "claimed"
  /\ Emit([s EXCEPT !.workers[w].journal = "starting",
                   !.workers[w].pc = "sendStart"], Name("PersistStarting", w))
SendStart(w) ==
  /\ s.workers[w].pc = "sendStart"
  /\ Emit([s EXCEPT !.workers[w].pc = "startPending"], Name("SendStart", w))
CommitStart(w) ==
  /\ s.workers[w].pc = "startPending"
  /\ LET j == s.workers[w].job
         grant == Current(w) /\ s.jobs[j].state = "claimed"
         next == IF grant THEN [s EXCEPT !.jobs[j].state = "executing",
                     !.jobs[j].started = TRUE, !.jobs[j].grants = @ + 1] ELSE s
     IN Emit([next EXCEPT !.workers[w].reply = IF grant THEN "yes" ELSE "no",
                         !.workers[w].pc = "startReply"], Name("CommitStart", w))
\* A duplicate HTTP request, not an automatic retry by the recovery agent.
ReplayStart(w) ==
  /\ s.workers[w].job \in Jobs /\ Current(w)
  /\ LET j == s.workers[w].job IN
     /\ s.jobs[j].state = "executing" /\ s.jobs[j].grants < 2
     /\ Emit(IF Mutation = "start" THEN [s EXCEPT !.jobs[j].grants = @ + 1]
             ELSE s, Name("ReplayStart", w))
DeliverStart(w) ==
  /\ s.workers[w].pc = "startReply"
  /\ Emit(IF s.workers[w].reply = "yes"
          THEN [s EXCEPT !.workers[w].pc = "permit"]
          ELSE [s EXCEPT !.workers[w].pc = "recovery"], Name("DeliverStart", w))
DropStart(w) ==
  /\ s.workers[w].pc = "startReply"
  /\ Emit([s EXCEPT !.workers[w].reply = "lost",
                   !.workers[w].pc = "recovery"], Name("DropStart", w))
PersistExecuting(w) ==
  /\ s.workers[w].pc = "permit"
  /\ Emit([s EXCEPT !.workers[w].journal = "executing",
                   !.workers[w].pc = "io"], Name("PersistExecuting", w))
PhysicalSend(w) ==
  /\ s.workers[w].pc = "io"
  /\ s.workers[w].journal = "executing" /\ s.workers[w].reply = "yes"
  /\ Emit([s EXCEPT !.workers[w].sends = @ + 1,
                   !.workers[w].pc = "effect"], Name("PhysicalSend", w))
RecordResult(w, result) ==
  /\ s.workers[w].pc = "effect"
  /\ Emit([s EXCEPT !.workers[w].result = result,
                   !.workers[w].journal = "result", !.workers[w].pc = "result"],
          Name("RecordResult", w) \o ":" \o result)
Crash(w) ==
  /\ s.workers[w].pc \notin {"idle", "done", "recovery", "completeReply"}
  /\ ~s.workers[w].crashed
  /\ Emit([s EXCEPT !.workers[w].pc = "recovery", !.workers[w].crashed = TRUE],
          Name("Crash", w))
Recover(w) ==
  /\ s.workers[w].pc = "recovery"
  /\ LET hasJournal == s.workers[w].journal # "none"
     IN Emit([s EXCEPT !.workers[w].pc = IF hasJournal THEN "result" ELSE "done",
                       !.workers[w].journal = IF hasJournal THEN "result" ELSE "none",
                       !.workers[w].result = IF @ # "none" THEN @ ELSE "uncertain"],
          Name("Recover", w))

BlockedClaim(w, j) ==
  /\ s.workers[w].pc = "idle" /\ s.jobs[j].state = "queued" /\ Busy(j)
  /\ Emit(s, Name(Name("BlockedClaim", w), j))

ExpireClaim(j) ==
  /\ s.jobs[j].state = "claimed"
  /\ Emit([s EXCEPT !.jobs[j].state = "queued"], Name("ExpireClaim", j))
ExpireExecuting(j) ==
  /\ s.jobs[j].state = "executing"
  /\ Emit([s EXCEPT !.jobs[j].state = IF Mutation = "requeue"
                   THEN "queued" ELSE "uncertain"], Name("ExpireExecuting", j))
ExpireJob(j) ==
  /\ s.jobs[j].state \in {"queued", "claimed"}
  /\ Emit([s EXCEPT !.jobs[j].state = "expired"], Name("ExpireJob", j))
Cancel(j) ==
  /\ s.jobs[j].state = "queued"
  /\ Emit([s EXCEPT !.jobs[j].state = "cancelled"], Name("Cancel", j))
Resolve(j) ==
  /\ s.jobs[j].state = "uncertain"
  /\ Emit([s EXCEPT !.jobs[j].state = "failed", !.jobs[j].resolved = TRUE],
          Name("Resolve", j))

SendComplete(w) ==
  /\ s.workers[w].pc \in {"result", "done"} /\ s.workers[w].result # "none"
  /\ Emit([s EXCEPT !.workers[w].pc = "completePending"], Name("SendComplete", w))
Disposition(w) ==
  LET job == s.jobs[s.workers[w].job]
      result == s.workers[w].result
  IN IF ~Current(w) /\ Mutation # "fence" THEN "obsolete"
     ELSE IF job.resolved /\ Mutation # "resolve" THEN "resolved"
     ELSE IF job.state \in {"succeeded", "failed"}
          THEN IF job.result = result THEN "accepted" ELSE "rejected"
     ELSE IF ((job.state \in {"claimed", "queued", "expired"} /\ result = "uncertain")
              \/ (job.state \in {"executing", "uncertain"}
                  /\ (result = "uncertain" \/ job.started))) THEN "accepted"
     ELSE "rejected"
CommitComplete(w) ==
  /\ s.workers[w].pc = "completePending"
  /\ LET j == s.workers[w].job
         outcome == Disposition(w)
         next == IF outcome = "accepted" /\ s.jobs[j].state \notin {"succeeded", "failed"}
                 THEN [s EXCEPT !.jobs[j].state = s.workers[w].result,
                                !.jobs[j].result = s.workers[w].result] ELSE s
     IN Emit([next EXCEPT !.workers[w].reply = outcome, !.workers[w].pc = "completeReply",
              !.fenceSafe = @ /\ (Current(w) \/ outcome = "obsolete"),
              !.resolveSafe = @ /\ (~Current(w) \/ ~s.jobs[j].resolved \/ outcome = "resolved")],
             Name("CommitComplete", w))
DropComplete(w) ==
  /\ s.workers[w].pc = "completeReply"
  /\ Emit([s EXCEPT !.workers[w].pc = "result", !.workers[w].reply = "lost"],
          Name("DropComplete", w))
DeliverComplete(w) ==
  /\ s.workers[w].pc = "completeReply"
  /\ s.workers[w].reply \in {"accepted", "obsolete", "resolved"}
  /\ Emit([s EXCEPT !.workers[w].pc = "done", !.workers[w].journal = "reported"],
          Name("DeliverComplete", w))

Next == (\E w \in Workers, j \in Jobs: Claim(w, j) \/ BlockedClaim(w, j))
     \/ (\E w \in Workers: PersistStarting(w) \/ SendStart(w) \/ CommitStart(w)
         \/ ReplayStart(w) \/ DeliverStart(w) \/ DropStart(w) \/ PersistExecuting(w)
         \/ PhysicalSend(w) \/ Crash(w) \/ Recover(w) \/ SendComplete(w)
         \/ CommitComplete(w) \/ DropComplete(w) \/ DeliverComplete(w)
         \/ (\E result \in {"uncertain", "succeeded"}: RecordResult(w, result)))
     \/ (\E j \in Jobs: ExpireClaim(j) \/ ExpireExecuting(j) \/ ExpireJob(j)
         \/ Cancel(j) \/ Resolve(j))
TypeOK == /\ \A j \in Jobs: s.jobs[j].state \in States
                           /\ s.jobs[j].attempt \in 0..MaxAttempts
                           /\ s.jobs[j].grants \in 0..2
          /\ \A w \in Workers: s.workers[w].job \in 0..JobCount
                              /\ s.workers[w].sends \in 0..1
StartUnique == \A j \in Jobs: s.jobs[j].grants <= 1
NoStartedRequeue == \A j \in Jobs: s.jobs[j].started => s.jobs[j].state # "queued"
ClaimSafe == s.claimSafe
FencingSafe == s.fenceSafe
ResolvedSafe == s.resolveSafe
NoAutomaticResend == \A j \in Jobs:
  Cardinality({w \in Workers: s.workers[w].job = j /\ s.workers[w].sends = 1}) <= 1
JournalBeforeSend == \A w \in Workers: s.workers[w].sends = 1 =>
  s.workers[w].journal \in {"executing", "result", "reported"}
NotLostStart == ~\E w \in Workers: s.workers[w].pc = "recovery"
                                 /\ s.workers[w].reply = "lost"
NotLostComplete == ~\E w \in Workers: s.workers[w].pc = "result"
                                    /\ s.workers[w].reply = "lost"
NotObsolete == ~\E w \in Workers: s.workers[w].reply = "obsolete"
NotResolved == ~\E w \in Workers: s.workers[w].reply = "resolved"
NotPhysicalSend == ~\E w \in Workers: s.workers[w].sends = 1
Spec == Init /\ [][Next]_vars
=============================================================================
