# Security Policy

## Supported Versions

Currently, only the latest version of the Stellar-Dex-Chat project is supported with security updates.

## Reporting a Vulnerability

### Private Vulnerability Reporting

We use GitHub's private vulnerability reporting feature to securely report security vulnerabilities.

**To report a security vulnerability:**

1. Visit the [Security Advisories](https://github.com/leojay-net/Stellar-Dex-Chat/security/advisories) page
2. Click "Report a vulnerability"
3. Fill in the details of the vulnerability
4. Submit the report privately

This ensures that the report is only visible to the repository maintainers until a fix is released.

### What to Include

Please include as much of the following information as possible:

- A description of the vulnerability
- Steps to reproduce the vulnerability
- Proof of concept (if applicable)
- Potential impact of the vulnerability
- Any suggested mitigations or fixes

### Scope

This security policy applies to:
- The Stellar-Dex-Chat smart contracts (Dechat/stellar-contracts)
- The frontend application (Dechat/dex_with_fiat_frontend)
- Any backend services or APIs

### Response Targets

- **Initial response**: Within 48 hours of receiving a report
- **Triaging**: Within 7 days of receiving a report
- **Fix timeline**: Depending on severity, typically within 30 days

### Security Best Practices

- Never include private keys or sensitive data in code
- Use environment variables for configuration
- Keep dependencies up to date
- Follow the principle of least privilege
- Audit smart contracts before deployment

### Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve the security of this project (with their permission).

## Threat model

What the FiatBridge contract defends against, and the residual risks, are described in [Dechat/stellar-contracts/docs/THREAT_MODEL.md](Dechat/stellar-contracts/docs/THREAT_MODEL.md).
