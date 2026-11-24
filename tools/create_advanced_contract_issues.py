import subprocess

REPO = "leojay-net/Stellar-Dex-Chat"

ISSUES = [
    {
        "title": "Feature: Oracle integration for USD-equivalent deposit limits",
        "labels": "enhancement,smart-contract,complexity: high",
        "body": """Currently, the contract enforces deposit limits strictly on native token amounts (e.g., 500 USDC vs 500 XLM), which results in vastly different actual value limits depending on the asset.

We need to integrate the Soroban Price Oracle to enforce a uniform fiat-value limit (e.g., $10,000 max deposit) across all whitelisted assets.

## Acceptance Criteria
- Integrate Soroban Price Oracle interface to fetch real-time prices.
- Update `deposit` function to calculate the USD equivalent of the deposit amount.
- Introduce a global fiat-value deposit limit accessible via `set_fiat_limit`.
- Validate that the new deposit plus the user's daily rolling volume does not exceed the fiat limit.
- Add comprehensive unit tests mockiimport subprocess

REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ld `refund
ISSUES = [
    {
        "title": pay    {
         "l        "labels": "enhancement,smart-contract,complexity: high",
        "body": u        "body": """Currently, the contract enforces deposit limbank details (e.g., KYC failure, invalid details), the admin needs a specialized function to refund that exact `receipt_id`.

Currently, the only way is to use the generic `withdraw` function, which breaks rece
## Acceptance Criteria
- Integrate Soroban Price Oracle interface to fetch real-time prices.
- Update `deposit` function to calculate the US
- - Inte `receipt_id` as - Update `deposit` function to calculate the USD equivalent of the d p- Introduce a global fiat-value deposit limit accessible via `set_fiat_limit`.
- ` - Validate that the new deposit plus the user's daily rolling volume does notni- Add comprehensive unit tests mockiimport subprocess

REPO = "leojay-net/Stellar-Dex-ChaFeature: Con
REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ldtes
"F
REPO = "ld `refund
ISSUES = [
 marR-cISSUES = [
    {
y: high",
        "         "l        "labeto        "body": u        "body": """Currently, the contract remove_token`, o
Currently, the only way is to use the generic `withdraw` function, which breaks rece
## Acceptance Criteria
- Integrate Soroban Price Oracle interface to fetch real-time prices.
- Update `deposit` functtor## Acceptance Criteria
- Integrate Soroban Price Oracle interface to fetch real-timnd- Integrate Soroban P~3- Update `deposit` function to calculate the US
- - Inte `receipt_idon- - Inte `receipt_id` as - Update `depo`cancel_a- ` - Validate that the new deposit plus the user's daily rolling volume does notni- Add comprehensive unit tests mockiimport subprocess

REPO = "leojay-net/Stellar-Dex-Chatu
REPO = "leojay-net/Stellar-Dex-ChaFeature: Con
REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ldtes
"F
REPO = "ld `refund
ISSUES = ["""REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPOce
"F
REPO = "ldtes
"F
REPO = "ld `rehdrRwa"F
REPO = "lheRadISSUES = [
 marR-no marocess i    {
y: high",
ouyd be         exCurrently, the only way is to use the generic `withdraw` function, which breaks rece
## Acceptance Criteria
- Ac## Acceptance Criteria
- Integrate Soroban Price Oracle interface to fetch real-timnt- Integrate Soroban Prt- Update `deposit` functtor## Acceptance Criteria
- Integrate Soroba d- Integrate Soroban Price Oracle interface to fe `- - Inte `receipt_idon- - Inte `receipt_id` as - Update `depo`cancel_a- ` - Validate that the new deposit plus the user's daily rolin
REPO = "leojay-net/Stellar-Dex-Chatu
REPO = "leojay-net/Stellar-Dex-ChaFeature: Con
REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ldtes
"F
REPO = "ld `refund
ISSUES = ["""REPO = "leojay-net/Stellar-Dex "tREPO = "leojay-net/Stellar-Dex-ChaFfoREPO = "leojay-net/Stellar-Dex-Chat"

"F
Rls": 
"F
REPO = "ldtes
"F
REPO = "ld `reityR h"F
REPO = "l  RboISSUES = ["""REPOti
"F
REPOce
"F
REPO = "ldtes
"F
REPO = "ld `rehdran ext"F
RE dura"F
REPO = " 6 months), the protocol coul marR-no marocess i    fty: high",
ouyd be      d-ouyd be it## Acceptance Criteria
- Ac## Acceptance Criteria
- Integrate Soroban Price Oracle interface to friod.
- Ac## Acceptance Criia- Integrate Soroban Pricefi- Integrate Soroba d- Integrate Soroban Price Oracle interface to fe `- - Inte `receipt_idon- - Inte `receipt_id` as - Update `depo`c tREPO = "leojay-net/Stellar-Dex-Chatu
REPO = "leojay-net/Stellar-Dex-ChaFeature: Con
REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ldtes
"F
REPO = "ld `refund
ISSUES = ["""REPO = "leojay-net/Stellar-DndREPO = "leojay-net/Stellar-Dex-ChaFghREPO = "leojay-net/Stellar-Dex-Chat"

"F
REPOov
"F
REPO = "ldtes
"F
REPO = "ld `reainR):"F
REPO =t(f"CreaISSUES = ["""REPO} 
"F
Rls": 
"F
REPO = "ldtes
"F
REPO = "ld `reityR h"F
REPO = "l  RboISSUES = ["""REPOti
"F
REPOce
"F
REPO = "ldtes
"F
s"]
  "F
RE body"F
REPO = "ldyR]
REPO = "l  RboISSUES t(f"Creating: {title}...")
        
   "F
REcmd ="F
REPO = "l   "gRE dura"F
REPO = " 6 mon  REPO = " "ouyd be      d-ouyd be it## Acceptance Criteria
- Ac## Acceptance Critbe- Ac## Acceptance Criteria
- Integrate Soroban r- Integrate Soroban Priced,- Ac## Acceptance Criia- Integrate Soroban Pricefi-  REPO = "leojay-net/Stellar-Dex-ChaFeature: Con
REPO = "leojay-net/Stellar-Dex-Chat"

"F
REPO = "ldtes
"F
REPO = "ld `refund
ISSating issue: {e.stderr}")

if __name__ == "__main__":
    main()
