# Training requests, appointments and quiz QR

## Client experience

Register, confirm email and complete your personal profile, then open **My account**. Select the equipment training (such as Laser Cutting or 3D Printing), enter your contact number, preferred date and available start/end times. Alternative days and project notes are optional. All times use Nepal time. A request is pending until staff accept it; it does not reserve equipment, start a subscription or grant certification.

External clients use the same account flow. Their account page labels the training section **Training for external clients**. When staff accept a request, its confirmed start/end time, trainer and instructions appear in **Your training requests**. Cancellation retains the request and audit history. Existing SMTP/confirmation limitations are unchanged; the later email phase remains deferred.

## Admin scheduling

Open **Training requests** in the staff sidebar. The **External clients** group includes other-college students, businesses/external participants and non-KEC members. **KEC students & staff** and **All clients** are also available. Category comes from the person's verified account-linked record, not a request's claimed category.

Search by name, email, phone or organization. Filter equipment and status. Results are paged at 50 rows. Open **Schedule / update request**, select **Accept / schedule**, set the actual start/end, assign an active trainer authorized for that certification, and enter meeting instructions.

If the session falls outside the preferred window, or an accepted time is changed, contact the participant yourself and check the agreement confirmation. The backend requires this confirmation and records it. This update does not send an automatic email, SMS or Calendar appointment.

A trainer cannot be assigned to overlapping separate sessions. Several participants may share one group session when the trainer, equipment certification, start and end all match exactly. Pending legacy requests keep their free-text availability and remain schedulable. Old scheduled requests need an assigned trainer and end time before they appear in a trainer's upcoming list.

## Trainer experience

In **My responsibilities → Training & QR sessions**, **My scheduled training** shows accepted sessions assigned to that trainer, within their equipment authority. It includes client contact, preferred time, confirmed time and staff instructions. Admins schedule or reschedule; trainers can record completion of their own assigned session after it ends. Completing attendance does not issue certification. Use the existing authorized quiz or practical assessment workflow for a pass.

## Custom quiz QR

**Training → Create quiz QR** is visible to Admins and Owners. Trainers use the same button under their Training responsibility. Choose a session label, active quiz, mapped equipment certification, QR admission window and maximum participants. Copy the link, download the QR PNG, or close admission early. The session label is retained in QR history.

The admission window is separate from each participant's quiz timer. Signed-in participants still require verified safety, waiver and adult status; equipment scopes, capacity, one admission per person, quiz version and certificate protections remain enforced. Closing admission does not shorten an assessment already started. QR session links use the existing configured app URL.

## Search and speed

Training has separate quiz-bank search and retained-attempt search by name, email, quiz, trainer or reference, plus pass/fail/status filters and 50-row paging. Search input is debounced. Table headings sort the current page.

Request groups and recently visited pages reuse a private memory cache for 15 seconds, keyed by user and access token. Refresh requests current data. Mutations and sign-out invalidate private cache. Request filters do not fetch the People directory or quiz banks. Equipment authority is calculated once per request query, rather than for every client row. QR image generation loads only when creating a QR. The backend still verifies authority for every change. Live server and network latency cannot be established by these local checks.

## Deployment

Apply additive migration **202610090018_training_request_scheduling.sql**, then deploy **portal-api** and **admin-api**, then publish the frontend. No Calendar worker, historical migration, authentication setting or existing certification needs changing. See the patch's START_HERE.md for PowerShell commands.
