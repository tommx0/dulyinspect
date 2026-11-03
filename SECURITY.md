# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately via
[GitHub security advisories](https://github.com/tommx0/dulyinspect/security/advisories/new).

Please include the affected version (shown in the app footer and in `/data/version`), the steps to reproduce and the
impact you expect. You will get a first answer within a few working days. Once a fix is available, the advisory is
published together with the new version.

## Supported versions

Only the latest version of the image gets security fixes. Updating is safe: the container backs up the database before
every version change (see [Updates](README.md#updates)).

## Scope

This repository packages the app and its backend services (PostgreSQL, Supabase services, Caddy) into one image.
Vulnerabilities in these third-party components are fixed by updating them here; please report them to their
maintainers as well.
