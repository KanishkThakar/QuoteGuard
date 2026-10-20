# Dhruvil Shah frontend handoff

This ZIP contains only Dhruvil's frontend scope and its actual UI screenshots. It includes the existing frontend foundation plus the changes prepared with AI assistance. No commit or push was made for this package. Review and understand the code before committing under your own account; the archive is not evidence that you personally authored or tested it.

## Delivered work

- Retained dashboard, client management, quotation editor, margin planner, finalisation, export and quick-search flows.
- Added a four-step Cache Lab guide for miss, hit, expiry and source invalidation.
- Corrected cold/warm instructions, displayed source provenance, readable expiry states and honest missing timing labels.
- Added explicit reload recovery for a 409 conflict, including a clearly labelled discard-and-reload action when editing.
- Fixed Vite Host forwarding for same-origin CSRF validation.
- Refined responsive Cache Lab layout and the keyboard skip link.
- Included real browser screenshots with synthetic records and a hash-verified original recorded Frankfurter response. These are not current exchange rates.

## Checks performed on the integrated local checkout

Production build passed. The complete browser suite passed 18 workflows; after the final telemetry and skip-link refinements, the affected eight focus/layout/Topic 6 workflows passed again. Tests cover the quote-to-export flow, source invalidation, conflict recovery, keyboard search, focus behavior, reduced motion, 320/390/768/1440 layouts and automated accessibility checks. npm audit reported zero vulnerabilities. Test files belong to the separate testing package and are not duplicated here.

## Apply only these files

1. Obtain the shared checkout containing Kanishk's backend commit f5d37fa. The GitHub repository was previously reset; this archive does not contain or publish the backend.
2. Extract this ZIP outside that checkout. Review HANDOFF.md, MANIFEST.json and FILES_TO_COMMIT.txt.
3. Compare and copy the contents of files/ into the matching repository paths. Do not overwrite another member's newer edits without review. Do not copy this archive's root metadata into the project.
4. From frontend/, run npm ci and npm run build. For development, start the backend, then npm run dev. The recorded testing setup is documented in the separate setup package; the backend API defaults to localhost:8000.
5. Review git status and your diff. When you are ready to make your own reviewed contribution, stage only the paths listed in FILES_TO_COMMIT.txt. Do not use git add . and do not push other members' files. No command in this package pushes automatically.

The ZIP intentionally excludes backend code, Git metadata, credentials, node_modules, build artifacts, deployment files and other members' tests/scripts. The screenshot paths under docs/images are shared documentation assets owned by this package.
