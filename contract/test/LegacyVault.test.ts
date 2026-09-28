import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

// Contract enum values: ACTIVE=0, GRACE=1, CONFIRMED=2, RELEASED=3
const ACTIVE = 0n;
const GRACE = 1n;
const CONFIRMED = 2n;
const RELEASED = 3n;

// Demo timers (seconds), same as .env.example
const CHECKIN = 30;
const GRACE_PERIOD = 30;
const RELEASE_DELAY = 15;

describe("LegacyVault", function () {
  // Fresh vault: nothing configured yet
  async function deployFixture() {
    const [owner, keeper, c1, c2, c3, b1, b2, stranger] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("LegacyVault");
    const vault = await Vault.deploy(keeper.address, CHECKIN, GRACE_PERIOD, RELEASE_DELAY, true);
    return { vault, owner, keeper, c1, c2, c3, b1, b2, stranger };
  }

  // Vault with trusted contacts + beneficiaries already set
  async function configuredFixture() {
    const f = await deployFixture();
    await f.vault.setTrustedContacts([f.c1.address, f.c2.address, f.c3.address]);
    await f.vault.setBeneficiaries([f.b1.address, f.b2.address]);
    return f;
  }

  // --- helpers to move the vault through its states ---
  async function missCheckIn() {
    await time.increase(CHECKIN + 1);
  }
  async function toGrace(vault: any) {
    await missCheckIn();
    await vault.startGrace();
  }
  async function toGraceOver(vault: any) {
    await toGrace(vault);
    await time.increase(GRACE_PERIOD + 1);
  }
  async function toConfirmed(vault: any, c1: any, c2: any) {
    await toGraceOver(vault);
    await vault.connect(c1).confirmDeath();
    await vault.connect(c2).confirmDeath();
  }

  // 1
  it("1. owner can check in", async function () {
    const { vault, owner } = await loadFixture(configuredFixture);
    await time.increase(10);
    await expect(vault.checkIn()).to.emit(vault, "CheckIn");
    const now = BigInt(await time.latest());
    expect(await vault.lastCheckIn()).to.equal(now);
    expect(await vault.checkInDeadline()).to.equal(now + BigInt(CHECKIN));
    expect(await vault.state()).to.equal(ACTIVE);
    expect(await vault.owner()).to.equal(owner.address);
  });

  // 2
  it("2. non-owner cannot check in", async function () {
    const { vault, stranger, c1 } = await loadFixture(configuredFixture);
    await expect(vault.connect(stranger).checkIn()).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(c1).checkIn()).to.be.revertedWithCustomError(vault, "NotOwner");
  });

  // 3
  it("3. owner sets beneficiaries", async function () {
    const { vault, b1, b2 } = await loadFixture(deployFixture);
    await expect(vault.setBeneficiaries([b1.address, b2.address])).to.emit(vault, "BeneficiariesUpdated");
    expect(await vault.getBeneficiaries()).to.deep.equal([b1.address, b2.address]);

    // replacing the list works, empty / zero / >10 do not
    await vault.setBeneficiaries([b2.address]);
    expect(await vault.getBeneficiaries()).to.deep.equal([b2.address]);
    await expect(vault.setBeneficiaries([])).to.be.revertedWithCustomError(vault, "EmptyBeneficiaries");
    await expect(vault.setBeneficiaries([ethers.ZeroAddress])).to.be.revertedWithCustomError(vault, "ZeroAddress");
    const eleven = Array(11).fill(b1.address);
    await expect(vault.setBeneficiaries(eleven)).to.be.revertedWithCustomError(vault, "TooManyBeneficiaries");
  });

  // 4
  it("4. owner sets trusted contacts", async function () {
    const { vault, c1, c2, c3 } = await loadFixture(deployFixture);
    await expect(vault.setTrustedContacts([c1.address, c2.address, c3.address])).to.emit(
      vault,
      "TrustedContactsUpdated"
    );
    expect(await vault.contactsSet()).to.equal(true);
    expect(await vault.isTrustedContact(c1.address)).to.equal(true);
    expect(await vault.isTrustedContact(c3.address)).to.equal(true);
    const status = await vault.getStatus();
    expect(status.trustedContacts).to.deep.equal([c1.address, c2.address, c3.address]);
  });

  // 5
  it("5. invalid contact lists fail (zero, duplicate, owner)", async function () {
    const { vault, owner, c1, c2 } = await loadFixture(deployFixture);
    await expect(
      vault.setTrustedContacts([c1.address, c2.address, ethers.ZeroAddress])
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    await expect(
      vault.setTrustedContacts([c1.address, c2.address, c1.address])
    ).to.be.revertedWithCustomError(vault, "DuplicateContact");
    await expect(
      vault.setTrustedContacts([c1.address, owner.address, c2.address])
    ).to.be.revertedWithCustomError(vault, "OwnerCannotBeContact");
    expect(await vault.contactsSet()).to.equal(false);
  });

  // 6
  it("6. anyone can startGrace after the deadline", async function () {
    const { vault, stranger } = await loadFixture(configuredFixture);
    await missCheckIn();
    await expect(vault.connect(stranger).startGrace()).to.emit(vault, "GraceStarted");
    expect(await vault.state()).to.equal(GRACE);
    const now = BigInt(await time.latest());
    expect(await vault.graceDeadline()).to.equal(now + BigInt(GRACE_PERIOD));
  });

  // 7
  it("7. cannot startGrace before the deadline (or without contacts)", async function () {
    const { vault, keeper } = await loadFixture(configuredFixture);
    await expect(vault.connect(keeper).startGrace()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");

    // a vault without trusted contacts can never enter grace
    const fresh = await loadFixture(deployFixture);
    await missCheckIn();
    await expect(fresh.vault.startGrace()).to.be.revertedWithCustomError(fresh.vault, "ContactsNotSet");
  });

  // 8
  it("8. contact #1 confirms after grace", async function () {
    const { vault, c1 } = await loadFixture(configuredFixture);
    await toGraceOver(vault);
    await expect(vault.connect(c1).confirmDeath())
      .to.emit(vault, "TrustedContactConfirmed")
      .withArgs(c1.address, 1, 0, anyValue);
    expect(await vault.confirmationCount()).to.equal(1n);
    expect(await vault.hasConfirmedThisRound(c1.address)).to.equal(true);
    expect(await vault.state()).to.equal(GRACE);
  });

  // 9
  it("9. contact #2 confirms -> CONFIRMED", async function () {
    const { vault, c1, c2 } = await loadFixture(configuredFixture);
    await toGraceOver(vault);
    await vault.connect(c1).confirmDeath();
    await expect(vault.connect(c2).confirmDeath()).to.emit(vault, "DeathConfirmed");
    expect(await vault.state()).to.equal(CONFIRMED);
    expect(await vault.confirmationCount()).to.equal(2n);
    const now = BigInt(await time.latest());
    expect(await vault.confirmedAt()).to.equal(now);
    const status = await vault.getStatus();
    expect(status.releaseAvailableAt).to.equal(now + BigInt(RELEASE_DELAY));
  });

  // 10
  it("10. non-contact cannot confirm", async function () {
    const { vault, stranger, owner, keeper } = await loadFixture(configuredFixture);
    await toGraceOver(vault);
    for (const s of [stranger, owner, keeper]) {
      await expect(vault.connect(s).confirmDeath()).to.be.revertedWithCustomError(vault, "NotTrustedContact");
    }
  });

  // 11
  it("11. same contact cannot confirm twice", async function () {
    const { vault, c1 } = await loadFixture(configuredFixture);
    await toGraceOver(vault);
    await vault.connect(c1).confirmDeath();
    await expect(vault.connect(c1).confirmDeath()).to.be.revertedWithCustomError(vault, "AlreadyConfirmed");
    expect(await vault.confirmationCount()).to.equal(1n);
  });

  // 12
  it("12. cannot confirm before graceDeadline", async function () {
    const { vault, c1 } = await loadFixture(configuredFixture);
    // in ACTIVE
    await expect(vault.connect(c1).confirmDeath()).to.be.revertedWithCustomError(vault, "InvalidState");
    // in GRACE but grace window still open
    await toGrace(vault);
    await expect(vault.connect(c1).confirmDeath()).to.be.revertedWithCustomError(vault, "GraceNotOver");
  });

  // 13
  it("13. release fails before confirmation", async function () {
    const { vault, c1 } = await loadFixture(configuredFixture);
    await expect(vault.release()).to.be.revertedWithCustomError(vault, "InvalidState");
    await toGraceOver(vault);
    await expect(vault.release()).to.be.revertedWithCustomError(vault, "InvalidState");
    await vault.connect(c1).confirmDeath(); // only 1 of 2
    await expect(vault.release()).to.be.revertedWithCustomError(vault, "InvalidState");
  });

  // 14
  it("14. release fails before releaseDelay, succeeds after", async function () {
    const { vault, c1, c2, stranger } = await loadFixture(configuredFixture);
    await toConfirmed(vault, c1, c2);
    await expect(vault.release()).to.be.revertedWithCustomError(vault, "ReleaseDelayNotPassed");
    await time.increase(RELEASE_DELAY);
    await expect(vault.connect(stranger).release()).to.emit(vault, "VaultReleased");
    expect(await vault.state()).to.equal(RELEASED);
    // owner cannot check in after release
    await expect(vault.checkIn()).to.be.revertedWithCustomError(vault, "InvalidState");
  });

  // 15
  it("15. owner checkIn during GRACE -> ACTIVE and clears confirmations", async function () {
    const { vault, c1 } = await loadFixture(configuredFixture);
    await toGraceOver(vault);
    await vault.connect(c1).confirmDeath();
    expect(await vault.confirmationCount()).to.equal(1n);

    await expect(vault.checkIn())
      .to.emit(vault, "VaultCancelled")
      .and.to.emit(vault, "CheckIn");
    expect(await vault.state()).to.equal(ACTIVE);
    expect(await vault.confirmationCount()).to.equal(0n);
    expect(await vault.graceDeadline()).to.equal(0n);
    expect(await vault.round()).to.equal(1n);
    expect(await vault.hasConfirmedThisRound(c1.address)).to.equal(false);
  });

  // 16
  it("16. owner cancel during CONFIRMED -> ACTIVE", async function () {
    const { vault, c1, c2 } = await loadFixture(configuredFixture);
    await toConfirmed(vault, c1, c2);
    await expect(vault.cancel()).to.emit(vault, "VaultCancelled");
    expect(await vault.state()).to.equal(ACTIVE);
    expect(await vault.confirmationCount()).to.equal(0n);
    expect(await vault.confirmedAt()).to.equal(0n);
    // deadline refreshed, so grace cannot restart immediately
    await expect(vault.startGrace()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");
    // release is no longer possible
    await time.increase(RELEASE_DELAY + 1);
    await expect(vault.release()).to.be.revertedWithCustomError(vault, "InvalidState");
    // cancel only allowed in GRACE / CONFIRMED
    await expect(vault.cancel()).to.be.revertedWithCustomError(vault, "InvalidState");
  });

  // 17
  it("17. old-round confirmations don't count after reset", async function () {
    const { vault, c1, c2 } = await loadFixture(configuredFixture);
    // round 0: c1 confirms, then owner checks in
    await toGraceOver(vault);
    await vault.connect(c1).confirmDeath();
    await vault.checkIn();

    // round 1: owner misses again
    await toGraceOver(vault);
    expect(await vault.confirmationCount()).to.equal(0n);
    // c2 alone must NOT reach CONFIRMED (c1's old vote is gone)
    await vault.connect(c2).confirmDeath();
    expect(await vault.confirmationCount()).to.equal(1n);
    expect(await vault.state()).to.equal(GRACE);
    // c1 must confirm again in the new round
    await vault.connect(c1).confirmDeath();
    expect(await vault.state()).to.equal(CONFIRMED);
    expect(await vault.hasConfirmed(0, c1.address)).to.equal(true);
    expect(await vault.hasConfirmed(1, c1.address)).to.equal(true);
  });

  // 18
  it("18. vault hash stored by owner and keeper", async function () {
    const { vault, keeper } = await loadFixture(configuredFixture);
    const h1 = ethers.keccak256(ethers.toUtf8Bytes("encrypted-vault-v1"));
    const h2 = ethers.keccak256(ethers.toUtf8Bytes("encrypted-vault-v2"));

    await expect(vault.storeVaultHash(h1)).to.emit(vault, "VaultHashStored");
    expect(await vault.vaultHash()).to.equal(h1);

    await expect(vault.connect(keeper).storeVaultHash(h2))
      .to.emit(vault, "VaultHashStored")
      .withArgs(keeper.address, h2, anyValue);
    expect((await vault.getStatus()).vaultHash).to.equal(h2);

    await expect(vault.storeVaultHash(ethers.ZeroHash)).to.be.revertedWithCustomError(vault, "ZeroHash");
  });

  // 19
  it("19. unauthorized actors cannot modify protected state", async function () {
    const { vault, stranger, keeper, c1, c2, c3, b1 } = await loadFixture(configuredFixture);
    const h = ethers.keccak256(ethers.toUtf8Bytes("x"));

    await expect(vault.connect(stranger).setBeneficiaries([b1.address])).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(
      vault.connect(keeper).setTrustedContacts([c1.address, c2.address, stranger.address])
    ).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(stranger).storeVaultHash(h)).to.be.revertedWithCustomError(vault, "NotKeeperOrOwner");
    await expect(vault.connect(c1).storeVaultHash(h)).to.be.revertedWithCustomError(vault, "NotKeeperOrOwner");
    await expect(vault.connect(keeper).checkIn()).to.be.revertedWithCustomError(vault, "NotOwner");

    await toGrace(vault);
    // contacts can't be changed mid-process, even by the owner
    await expect(vault.setTrustedContacts([c1.address, c2.address, stranger.address])).to.be.revertedWithCustomError(
      vault,
      "InvalidState"
    );
    await expect(vault.connect(stranger).cancel()).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(c3).cancel()).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(keeper).resetDemo()).to.be.revertedWithCustomError(vault, "NotOwner");
  });

  // 20
  it("20. resetDemo only works in demoMode and RELEASED", async function () {
    const { vault, c1, c2, stranger } = await loadFixture(configuredFixture);

    // not RELEASED yet
    await expect(vault.resetDemo()).to.be.revertedWithCustomError(vault, "InvalidState");

    await toConfirmed(vault, c1, c2);
    await time.increase(RELEASE_DELAY);
    await vault.release();
    await expect(vault.connect(stranger).resetDemo()).to.be.revertedWithCustomError(vault, "NotOwner");

    await expect(vault.resetDemo()).to.emit(vault, "VaultCancelled").withArgs(
      await vault.owner(),
      "demo reset",
      1,
      anyValue
    );
    expect(await vault.state()).to.equal(ACTIVE);
    expect(await vault.confirmationCount()).to.equal(0n);
    expect(await vault.round()).to.equal(1n);

    // a non-demo vault can never be reset
    const [, keeper] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("LegacyVault");
    const prod = await Vault.deploy(keeper.address, CHECKIN, GRACE_PERIOD, RELEASE_DELAY, false);
    await prod.setTrustedContacts([c1.address, c2.address, stranger.address]);
    await toConfirmed(prod, c1, c2);
    await time.increase(RELEASE_DELAY);
    await prod.release();
    await expect(prod.resetDemo()).to.be.revertedWithCustomError(prod, "NotDemoMode");
  });

  // Extra: constructor validation
  it("constructor rejects zero keeper and zero periods", async function () {
    const [, keeper] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("LegacyVault");
    await expect(Vault.deploy(ethers.ZeroAddress, 30, 30, 15, true)).to.be.revertedWithCustomError(Vault, "ZeroAddress");
    await expect(Vault.deploy(keeper.address, 0, 30, 15, true)).to.be.revertedWithCustomError(Vault, "ZeroPeriod");
    await expect(Vault.deploy(keeper.address, 30, 0, 15, true)).to.be.revertedWithCustomError(Vault, "ZeroPeriod");
    await expect(Vault.deploy(keeper.address, 30, 30, 0, true)).to.be.revertedWithCustomError(Vault, "ZeroPeriod");
  });
});
