"""
Amanat Claim Agent

Provides claim guidance based on the institution and asset type.
This module is loaded automatically by the Amanat backend.
"""

OFFICIAL_SOURCES = {
    "SBI": {
        "Savings Account": [
            "https://sbi.co.in/documents/26274/68559/Application%20Form%20for%20Settlement%20of%20Claim%20of%20Deceased%20Constituents%20%26%20Annexures.pdf/8bb2b559-33ca-1784-ac2a-65dea0bdc6b6?t=1601702302029"
        ],
        "Fixed Deposit": [
            "https://sbi.co.in/documents/26274/68559/Application%20Form%20for%20Settlement%20of%20Claim%20of%20Deceased%20Constituents%20%26%20Annexures.pdf/8bb2b559-33ca-1784-ac2a-65dea0bdc6b6?t=1601702302029"
        ]
    },
    "LIC": {
        "Life Insurance": [
            "https://www.licindia.in/en/web/guest/claims-settlement-requirements"
        ]
    },
    "EPFO": {
        "EPF": [
           "https://www.epfindia.gov.in/site_docs/PDFs/Downloads_PDFs/Form_CCF_death.pdf"
        ]
    },
    "HDFC Mutual Fund": {
        "Mutual Fund": [
           "https://www.amfiindia.com/investor/become-mf-distributor?zoneName=deathOfUnitHolder"
        ]
    }
}


def get_claim_guide(asset: dict) -> dict:
    """
    Return claim guidance for one Amanat asset.

    Parameters
    ----------
    asset : dict
        Asset following the shared Amanat asset schema.

    Returns
    -------
    dict
        Claim steps, required documents, sources and disclaimer.
    """

    institution = str(asset.get("institution", "")).strip()
    asset_type = str(asset.get("asset_type", "")).strip()
    nominee = asset.get("nominee")

    # Normalize common variations
    institution_key = institution.lower()
    asset_type_key = asset_type.lower()

    # ---------------------------------------------------------
    # SBI
    # ---------------------------------------------------------
    if institution_key == "sbi" and asset_type_key == "savings account":
        steps = [
            "Obtain the death certificate.",
            "Contact the SBI branch where the account is maintained.",
            "Submit the applicable deceased-account claim form.",
            "Submit the required nominee KYC and supporting documents.",
            "Submit bank details required for settlement."
        ]

        documents = [
            "Death certificate",
            "Deceased-account claim form",
            "Nominee KYC / identity proof",
            "Bank details or cancelled cheque"
        ]

        if not nominee:
            steps.append(
                "No nominee is recorded in the document; ask SBI about "
                "the applicable legal-heir or succession procedure."
            )

        return {
            "steps": steps,
            "documents": documents,
            "sources": OFFICIAL_SOURCES["SBI"]["Savings Account"],
            "disclaimer": "Guidance only, not legal advice."
        }

    # ---------------------------------------------------------
    # SBI Fixed Deposit
    # ---------------------------------------------------------
    if institution_key == "sbi" and asset_type_key == "fixed deposit":
        steps = [
            "Obtain the death certificate.",
            "Contact the SBI branch where the fixed deposit is maintained.",
            "Submit the applicable deceased-depositor claim form.",
            "Submit the required nominee KYC and supporting documents.",
            "Submit the original FD/deposit documents if required."
        ]

        documents = [
            "Death certificate",
            "Deceased-depositor claim form",
            "Nominee KYC / identity proof",
            "Original FD/deposit document, if applicable"
        ]

        if not nominee:
            steps.append(
                "No nominee is recorded; ask SBI about the applicable "
                "legal-heir or succession procedure."
            )

        return {
            "steps": steps,
            "documents": documents,
            "sources": OFFICIAL_SOURCES["SBI"]["Fixed Deposit"],
            "disclaimer": "Guidance only, not legal advice."
        }

    # ---------------------------------------------------------
    # LIC
    # ---------------------------------------------------------
    if institution_key == "lic" and asset_type_key == "life insurance":
        steps = [
            "Obtain the death certificate issued by the appropriate authority.",
            "Inform the LIC servicing branch about the death.",
            "Complete the applicable death claim form.",
            "Submit the original policy document, where required.",
            "Submit nominee KYC and bank details required for settlement."
        ]

        documents = [
            "Death certificate",
            "Original policy bond",
            "Death claim form",
            "Nominee identity proof",
            "Bank details / cancelled cheque"
        ]

        if not nominee:
            steps.append(
                "No nominee is recorded; ask LIC about the applicable "
                "claim and legal-heir requirements."
            )

        return {
            "steps": steps,
            "documents": documents,
            "sources": OFFICIAL_SOURCES["LIC"]["Life Insurance"],
            "disclaimer": "Guidance only, not legal advice."
        }

    # ---------------------------------------------------------
    # EPFO
    # ---------------------------------------------------------
    if institution_key == "epfo" and asset_type_key == "epf":
        steps = [
            "Obtain the member's death certificate.",
            "Complete the applicable EPFO death-claim forms.",
            "Submit the required claimant/nominee identity documents.",
            "Submit bank details required for settlement.",
            "Submit the claim through the applicable EPFO/employer process."
        ]

        documents = [
            "Death certificate",
            "EPFO death-claim form",
            "Nominee/claimant identity proof",
            "Bank details"
        ]

        if not nominee:
            steps.append(
                "No nominee is recorded; the applicable claimant/legal-heir "
                "procedure should be confirmed with EPFO."
            )

        return {
            "steps": steps,
            "documents": documents,
            "sources": [
                "https://www.epfindia.gov.in/site_docs/PDFs/Downloads_PDFs/Form_CCF_death.pdf"
            ],
            "disclaimer": "Guidance only, not legal advice."
        }

    # ---------------------------------------------------------
    # Mutual Fund
    # ---------------------------------------------------------
    if asset_type_key == "mutual fund":
        steps = [
            "Obtain the death certificate.",
            "Contact the mutual fund / registrar involved in the folio.",
            "Submit the applicable transmission or death claim request.",
            "Submit nominee/claimant KYC and required supporting documents.",
            "Provide bank details required for transmission or settlement."
        ]

        documents = [
            "Death certificate",
            "Transmission / claim request",
            "Nominee/claimant KYC",
            "Bank details",
            "Other documents requested by the AMC/RTA"
        ]

        if not nominee:
            steps.append(
                "No nominee is recorded; confirm the applicable legal-heir "
                "or transmission procedure with the AMC/RTA."
            )

        return {
            "steps": steps,
            "documents": documents,
            "sources": [
                "https://www.amfiindia.com/investor/become-mf-distributor?zoneName=deathOfUnitHolder"
            ],
            "disclaimer": "Guidance only, not legal advice."
        }

    # ---------------------------------------------------------
    # Unknown / unsupported asset
    # ---------------------------------------------------------
    return {
        "steps": [
            "The institution or asset type could not be matched safely.",
            "Verify the institution and asset details from the source document.",
            "Contact the relevant institution through its official channel."
        ],
        "documents": [
            "Death certificate",
            "Identity proof",
            "Relevant asset/account/policy document"
        ],
        "sources": [],
        "disclaimer": "Guidance only, not legal advice."
    }