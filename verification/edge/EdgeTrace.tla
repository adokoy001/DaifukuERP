---------------------------- MODULE EdgeTrace -----------------------------
EXTENDS Edge
CONSTANT TraceEvents, TraceStates, TraceAttempts, TraceGrants, TraceJournals, TraceSends
VARIABLE step
TraceVars == <<s, step>>
TraceInit == Init /\ step = 1
TraceNext == /\ step < Len(TraceEvents)
             /\ Next /\ s'.event = TraceEvents[step + 1]
             /\ step' = step + 1
TraceSpec == TraceInit /\ [][TraceNext]_TraceVars
ProjectionMatches == /\ [j \in Jobs |-> s.jobs[j].state] = TraceStates[step]
                     /\ [j \in Jobs |-> s.jobs[j].attempt] = TraceAttempts[step]
                     /\ [j \in Jobs |-> s.jobs[j].grants] = TraceGrants[step]
                     /\ [w \in Workers |-> s.workers[w].journal] = TraceJournals[step]
                     /\ [w \in Workers |-> s.workers[w].sends] = TraceSends[step]
TraceUnfinished == step < Len(TraceEvents)
=============================================================================
