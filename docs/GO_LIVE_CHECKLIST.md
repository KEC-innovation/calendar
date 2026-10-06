# v2 go-live sequence

Use `MAC_UPDATE_AND_RUN.md` for the existing project; do not follow a first-import workflow again.

1. Apply additive migrations 009–010 and deploy all six functions.
2. Confirm existing people, certificates and staff-verified prerequisites remain present.
3. Publish the frontend and configure APP_URL and allowed origins.
4. Configure custom SMTP and Auth redirect URLs; test confirmation, invitation and recovery email delivery.
5. Test student account linking with a separate account; only its own records must appear.
6. Test a trainer with only Training permission: QR/manual entry work; access verification and subscriptions are denied.
7. Test a QR on a phone: expiry, one attempt, passing and booking. Avoid re-testing a real already-certified student on the same equipment.
8. Test a booking conflict and cancellation; keep the confirmed booking intact.
9. Confirm published hours/closures and the policy duration discrepancy with the team.
10. Configure optional Calendar sync only if wanted, with viewers given read-only access.

Physical supervision, waiver evidence, incidents, appeals, reduced-capacity releases and competing-request priority are staff procedures. The policy page explicitly identifies these limits.
