# Multiplayer AI — Real User Testing Guide (Hinglish)

Ye file tumhe ek real user ki tarah poore app ko test karne mein help karegi. Har feature ke saamne likha hai: **kya karna hai**, **kyun karna hai** (real user aisa kyun karega), aur **kya check karna hai** (kya sahi dikhna chahiye).

Best tareeka: ise ek "story" ki tarah follow karo — jaise ek asli team apne kaam ke liye is platform ko use karegi, step by step, na ki sirf ek-ek feature alag-alag test karo.

---

## Setup (ek baar)

1. Do alag browser profiles/tabs banao — ek "Manager" (tum) ke liye, ek "Teammate" ke liye (agar dusra Clerk test account bana sako to best hai — warna ek incognito window use kar lo dusre account ke liye)
2. Ek GitHub repo connect karo (Settings → Tools) jisme kuch real issues/PRs hon, taaki Context Spine (Feature 2.5) test ho sake

---

## PHASE 1 — Core Session Features (Steps 1-16)

### 1. Naya session banao aur baat karo (Features 1.1, 1.6/1.7)

**Kya karo:** `/sessions` par jao, "New Session" par click karo, ek generic session banao. Kuch messages type karo jaise ek real kaam discuss kar rahe ho — "Should we use Postgres or MongoDB for this project?"

**Real user kyun karega:** Ye basic use-case hai — AI se kaam ki baat karna.

**Kya check karo:**
- Message bhejte hi turant dikhna chahiye (streaming, piece-by-piece — mock response aayega `[MOCK RESPONSE]` ke saath, ye normal hai)
- Timeline scrubber (session ke top/side mein) se scrub karke purane messages tak jump karo — "Viewing as of event #N" banner dikhna chahiye
- "Return to live" par click karo, current state wapas aana chahiye

---

### 2. Doosre user ko session mein invite karo (Feature 1.2 — Roles)

**Kya karo:** Apni team member (dusra tab/account) ko is session mein add karo, unhe "Reviewer" role do.

**Real user kyun karega:** Team ke saath collaborate karna hai, sabko full control nahi dena.

**Kya check karo:**
- Reviewer wale account se message bhejne ki koshish karo — block hona chahiye (sirf "suggest" kar sakta hai)
- Reviewer se ek "suggestion" bhejo, phir owner wale account se usse "Accept" karo — wo real message ban jaana chahiye
- "Take control" button use karke role switch karo, dusre tab mein turant dikhna chahiye (live update)

---

### 3. Do tabs khol kar live collaboration dekho (Feature 1.1 — Real-time)

**Kya karo:** Same session ko do tabs mein kholo (dono accounts se). Ek tab se message bhejo.

**Real user kyun karega:** Ye asli "multiplayer" experience hai — team ek saath dekh rahi hai AI kya kar raha hai.

**Kya check karo:**
- Doosre tab mein bina refresh kiye naya message aur agent ka reply dikhna chahiye
- Header mein "live" indicator dikhna chahiye

---

### 4. Ek checkpoint policy banao (Feature 1.3)

**Kya karo:** Settings → Policies mein jao, ek policy banao jo "deploy" keyword pe trigger ho. Phir session mein "let's deploy this to production" jaisa message bhejo.

**Real user kyun karega:** Team nahi chahti ki AI khud se production actions le le bina approval ke.

**Kya check karo:**
- Message bhejte hi session "pause" ho jaana chahiye, checkpoint card dikhna chahiye
- Reviewer se resolve karne ki koshish karo — reject hona chahiye (403)
- Owner se "Approve" karo — session resume hona chahiye aur agent ka reply aana chahiye

---

### 5. Session ko branch karo (Feature 1.4)

**Kya karo:** Kisi purane message se "Branch from here" click karo. Naye branch mein alag direction mein baat karo (jaise "actually let's use MongoDB instead").

**Real user kyun karega:** Do alag approaches explore karna hai bina original conversation kharab kiye.

**Kya check karo:**
- Naya branch banega jisme purana history (fork point tak) dikhega
- Branch mein naya message original session mein NAHI dikhna chahiye
- `/sessions/compare` page par dono branches side-by-side dekho
- Ek "merge" record karo (summary likh kar)

---

### 6. Handoff brief generate karo (Feature 1.5)

**Kya karo:** Kaafi messages bhejne ke baad, "Generate handoff" button click karo. Fir "Pending decisions" panel check karo.

**Real user kyun karega:** Doosri timezone ki team ko context dena hai bina poora transcript padhe.

**Kya check karo:**
- Ek summary card timeline mein dikhna chahiye
- Agar koi checkpoint abhi resolve nahi hua, to wo "Pending decisions" mein dikhna chahiye

---

### 7. Cost meter dekho (Feature 1.8)

**Kya karo:** Kaafi messages bhejne ke baad session header mein cost meter dekho. Settings → Budget mein org ka total spend check karo. Ek chhota budget limit set karo aur limit cross karne ki koshish karo.

**Real user kyun karega:** CFO/manager AI spending control mein rakhna chahta hai.

**Kya check karo:**
- Cost meter live update ho raha hai har message ke baad
- Budget limit cross hone par naya session/message create karna block ho jaana chahiye (existing session chalti rahe)

---

### 8. GitHub connect karo (Feature 1.9 — Tool Mesh)

**Kya karo:** Settings → Tools mein GitHub connect karo (agar pehle se nahi hai). Permission ko "restricted" set karo, phir agent se GitHub tool use karwane ki koshish karo (mock tool call trigger karo message mein).

**Real user kyun karega:** Team decide karna chahti hai ki AI kaunse external tools use kar sakta hai.

**Kya check karo:**
- "restricted" hone par tool call block ho
- "requires_checkpoint" set karne par checkpoint raise ho
- "allowed" set karne par seedha chal jaye

---

### 9. Incident/Architecture template se session banao (Feature 1.10)

**Kya karo:** "New Session" mein "Incident Response" ya "Architecture Decision" template choose karo.

**Real user kyun karega:** SRE team ek incident manage kar rahi hai, ya eng team koi architecture decision discuss kar rahi hai — dono ko structured panels chahiye.

**Kya check karo:**
- Extra panel dikhna chahiye (impacted services / decision options) jo generic session mein nahi hota
- Panel mein data update karo, save ho jaana chahiye

---

## PHASE 2 — Expansion Features (Steps 17-24)

### 10. Multiple agents banao (Feature 2.4 — Agent Fleet)

**Kya karo:** Settings → Agents mein 2-3 alag agents banao (alag naam/config ke saath, jaise "Research Agent", "Code Reviewer Agent"). New session banate waqt agent choose karo.

**Real user kyun karega:** Alag kaam ke liye alag specialized AI chahiye, ek generic assistant se kaam nahi chalega.

**Kya check karo:**
- Dashboard mein har agent ke against run count, avg cost, fail-rate dikhna chahiye
- Agent-specific tool permission set karo (jaise sirf "Code Agent" ko GitHub access ho)

---

### 11. Team memory build karo (Feature 2.1)

**Kya karo:** Session complete karne ke baad "Extract" button click karo (memory panel mein). Curation queue mein jaake pending facts approve karo. Naya session banao aur dekho kya wo fact recall hota hai.

**Real user kyun karega:** Team chahti hai AI ko unke project/company ke baare mein yaad rahe, har baar shuru se na batana pade.

**Kya check karo:**
- Extracted facts sahi source session ki citation ke saath dikhein
- Approve karne ke baad hi wo naye session mein surface hon
- Ek doosre user (dusre tab) ka "personal" scope wala fact tumhare account mein na dikhe

---

### 12. Ek goal do, dekho AI kaise divide karta hai (Feature 2.3 — Delegation Chains)

**Kya karo:** Delegation panel mein ek high-level goal do (jaise "Prepare Q4 pricing strategy"). Dekho task graph banta hai.

**Real user kyun karega:** Manager chahta hai ki bada kaam automatically chhote sub-tasks mein baant diya jaye, alag agents/logon ko assign ho.

**Kya check karo:**
- 2-3 sub-task nodes banne chahiye, har ek ka apna child session ho
- Dependent tasks tab tak "blocked" rahein jab tak unki dependency complete na ho
- Sab complete hone par parent session mein ek synthesis summary aani chahiye

---

### 13. Client/partner ko guest ki tarah invite karo (Feature 2.2)

**Kya karo:** Kisi session ka "Invite guest" link banao, "Observer" role ke saath. Us link ko incognito window mein kholo (bina login kiye).

**Real user kyun karega:** Consulting firm apne client ko live session dikhana chahti hai, bina unhe full account diye.

**Kya check karo:**
- Guest link se seedha session dikhe, koi signup na maange
- Guest kisi doosri session ka URL try kare to block ho jaye
- "internal_only" wali session guest ko kabhi na dikhe

---

### 14. Related context automatically dekho (Feature 2.5 — Context Spine)

**Kya karo:** "Incident Response" template se session banao, subject mein aisa keyword daalo jo tumhare connected GitHub repo ke kisi issue/PR se match kare.

**Real user kyun karega:** SRE ko incident session shuru karte hi related past issues/PRs dikhne chahiye, khud dhoondhna na pade.

**Kya check karo:**
- "Related context" panel mein matching GitHub items dikhein, clickable links ke saath
- Agar kuch match na ho to "no related context found" dikhe, error nahi

---

### 15. Ek reusable pattern banao (Feature 2.6 — Pattern Library)

**Kya karo:** Settings → Patterns mein ek pattern banao (jaise "Research → Review → Approve" steps ke saath, ek checkpoint attach karke). "New session from pattern" se naya session banao.

**Real user kyun karega:** Team ek baar-baar hone wala workflow (jaise contract review) template bana kar rakhna chahti hai.

**Kya check karo:**
- Naye session mein sahi agent aur checkpoint automatically wired ho
- Org ki normal (default) policies bhi is session par lagu hon — sirf pattern ki attached policy hi nahi (dono saath chalne chahiye)

---

### 16. Ek successful session ko playbook banao (Feature 2.8)

**Kya karo:** Ek session complete karne ke baad "Make this repeatable" click karo.

**Real user kyun karega:** Ek session bahut achhe se chala, ab isi tarah ka kaam baar-baar automate karna hai.

**Kya check karo:**
- Naya pattern library mein appear ho, us session mein actually use hue agents/checkpoints ke saath
- Us extracted pattern se naya session spin-up karke check karo ki chalta hai

---

### 17. Analytics dashboard dekho (Feature 2.7)

**Kya karo:** Settings → Analytics kholo, kaafi activity karne ke baad (messages, checkpoints approve/reject, take-control, alag agents pe kharcha).

**Real user kyun karega:** Manager/leadership overall AI usage aur governance health dekhna chahti hai.

**Kya check karo:**
- Session volume, checkpoint approval rate, cost per agent — sab numbers realistic dikhne chahiye jo tumne actually kiya
- Naya activity karne ke baad dashboard refresh karke updated numbers aane chahiye

---

## Ek poori "real team" story (sab kuch ek saath test karne ke liye)

Agar tumhe ek hi baithak mein sab kuch ek flow mein try karna hai, to ye scenario follow karo:

1. Manager ke roop mein ek "Architecture Decision" session banao (Feature 1.10)
2. Related GitHub context automatically aata dekho (Feature 2.5)
3. Teammate ko Reviewer invite karo (Feature 1.2), do tabs mein live dekho (Feature 1.1)
4. Ek "deploy" keyword wala message bhejo, checkpoint trigger hone do (Feature 1.3)
5. Approve karo, aage baat karo, phir ek dusra approach explore karne ke liye branch karo (Feature 1.4)
6. Handoff brief generate karo jaise India team ko dena ho (Feature 1.5)
7. Cost meter check karo (Feature 1.8)
8. Session complete karke memory extract karo (Feature 2.1) aur playbook banao (Feature 2.8)
9. Ek client ko guest ki tarah invite karo final result dikhane ke liye (Feature 2.2)
10. Analytics dashboard mein jaake pura activity summary dekho (Feature 2.7)

Ye ek scenario poore 24 features ka 80% cover kar deta hai ek connected flow mein — bilkul waisa jaisa ek real team use karegi.

---

## Yaad rakhne wali baat

Jahan bhi tumhe `[MOCK RESPONSE]` ya `[MOCK HANDOFF BRIEF]` dikhega, wo expected hai — abhi tak real Anthropic API key nahi lagi hai. In steps ki functionality (mechanism) sahi honi chahiye, lekin **content ki quality abhi judge mat karo** — wo sirf real API key aane ke baad dobara test hoga:
- Step 4 (AI replies), Step 7 (streaming), Step 12 (handoff brief), Step 13 (cost numbers)
- Step 18 (memory extraction quality), Step 19 (task decomposition quality), Step 23 (playbook quality)
