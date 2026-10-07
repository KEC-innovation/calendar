# KEC Makerspace staff access

This additive update follows Policy Book v1.1 (August 2026) and the confirmed decision that **Admin keeps all operational controls**. It separates account-management authority from operational duties and adds equipment-specific authority for assigned trainers.

| Account role | Operational controls | Staff accounts and responsibility assignments |
| --- | --- | --- |
| Owner | All operations, all training certification types | Invite staff, change roles/status, assign tasks and training scope |
| Admin | Operational controls and all training types, excluding archival; includes bookings, equipment, hours, people, certifications, quizzes, subscriptions, materials and audit history | Owner required |
| Trainer | Only assigned tasks; existing Trainer accounts retain their existing default training task | Owner required |
| Staff (stored as viewer) | Only assigned tasks; no tasks by default | Owner required |
| MS Ambassador | No tasks by default; future material checkout is separate | Owner required |

A title on the team page or an ambassador/intern appointment does not automatically grant website access. Owner assigns permissions to an actual staff account. Owner should confirm training eligibility under the Policy Book: the Operations Lead, Training Lead, or a certified ambassador/intern conducts equipment training. An administrative account role does not itself certify its holder to use equipment.

## Assign duties

Owner signs in, opens **Staff access**, selects the staff member, and reviews the checked responsibilities. The checkboxes load that person's saved tasks rather than starting blank.

- **Training:** open/close authorized QR sessions and record equipment training. Choose individual certification types, or deliberately authorize all current and future types. The scope is by certification category (for example, 3D Printing), not by individual printer.
- **Access:** add participant records, verify one-time safety/waiver/adult records with evidence, and invite participant accounts. This does not grant certification-management or equipment-training authority.
- **Subscriptions:** record agreements, receipts and cancellations using existing plan rules. This does not grant access verification or training authority.
- **Catalog:** maintain published materials and electronics. This does not grant subscription, access or training authority.

Record an eligibility/responsibility note of at least ten characters. For training, identify the reviewed practical certification, appointed training responsibility, or other documented eligibility basis. The system records the Owner, old and new access, and note in audit history; it does not infer trainer eligibility from staff names, job titles or uploaded certificates.

New Trainer invitations must have equipment authority assigned before opening a QR or recording training. Existing training authority is carried forward: the migration does not silently demote anyone. Existing general authority appears as **All types · review existing authority** so Owner can review and narrow it. An inactive account remains unable to perform staff operations even if it has saved tasks.

## Review roles and activation

Use **Edit access** rather than changing a table dropdown immediately. Role and activation changes require an access review note.

Activation/deactivation and changes between Trainer, Staff and MS Ambassador roles preserve saved duties and training scope. Switching an account with assigned duties to Admin or Owner grants the broad role's controls. Demoting Admin/Owner to Trainer, Staff or MS Ambassador removes broad authority; Owner then assigns the intended duties separately. Role labels alone do not add new duties during an edit.

The final active Owner cannot be demoted or deactivated through the staff API. Changes are serialized and checked inside one database transaction to avoid simultaneous requests removing all Owners. A transfer can proceed once another active Owner exists. This protects application changes; privileged SQL/Auth administration outside the app remains an administrator responsibility.

Server authorization reads current active access on each request. Staff should reload or sign in again to refresh navigation and assignment choices after a change. A stale screen cannot confer a revoked permission.

## Training records and privacy

Assigned training workspaces expose only permitted quiz certification mappings and the trainer's own QR/manual-record history. Owner and Admin can review all operational history. Participant lookup remains available for the assigned task; private quiz answer keys stay excluded.

The database enforces training scope for QR creation, new admissions and manual training. Removing equipment authority blocks new QR admissions for that certification. An already-started assessment can still submit its score; if the trainer has lost authority, it cannot issue a new certificate and shows the existing review-needed result. Closing QR admission alone still preserves already-started attempts and their timer.

Changing trainer authority never revokes certificates already issued. Existing student prerequisites, suspensions, certificate permanence, booking limits and Google Calendar queue behavior remain enforced by their existing functions.

## Policy decisions kept separate

This permission update does not change opening hours, the existing approved eight-minute/16-of-20 quiz configuration, pricing, fairness limits, cancellation rules or disciplinary procedures. The Policy Book's ten-minute quiz wording still needs a separate operational decision before changing the timer. Fair-use limits, reduced-capacity arbitration, incident appeals and walk-in handling remain the documented staff procedures; this patch does not introduce automatic penalties or new numeric limits.

## October account and workflow update

The stored `viewer` role is now labeled **Staff**. **MS Ambassador** is a distinct `ambassador` role; new invitations start with no operational duties and no equipment training scope. Filament/electronics request approvals and checkout remain in the separate Google Apps Script system until integration. Owner can explicitly assign existing duties to a qualified ambassador with a review note. An ambassador appointment does not itself grant training authority.

All staff workspace access requires verified email, a personal password and authenticator verification (AAL2). New staff accounts see authenticator setup before the workspace. Direct staff RPCs enforce AAL2 too. Personal records and equipment use remain separate from administrative login.

Owner controls archival of people, equipment, published catalog items, closures and active quiz banks. A meaningful reason is required. Permanent deletion of business records is blocked, including for Owner, to preserve evidence. Operational cancellations, certification suspension/revocation, quiz bank revisions and QR closure retain their history and remain assigned operational duties. Audit history stays immutable.

Registration creates a personal record only after email confirmation and profile confirmation. Existing email-matched records are linked without overwriting details, certifications or passed results. Student-provided category/profile fields never create a staff role or certify safety, waiver, age or equipment training.

Participants request equipment training with a phone number and availability in My account. Assigned trainers see only requests inside their equipment scope; Admin and Owner see all types. Staff can post a future session time and instructions, complete an attended appointment or cancel a request with a note. Completing the request never issues a certificate: use the existing supervised quiz or documented manual assessment. Minors use supervised outreach through the help desk.
