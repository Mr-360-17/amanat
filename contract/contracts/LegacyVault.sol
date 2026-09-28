// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title LegacyVault
/// @notice A "dead man's switch" for digital legacy access.
///         The owner must check in periodically. If they miss the deadline,
///         anyone (normally the keeper agent) can start a grace period.
///         After grace ends, 2 of 3 trusted contacts must confirm, then after
///         a short release delay anyone can mark the vault RELEASED.
/// @dev    This contract NEVER holds or transfers funds (nothing is payable).
///         Only addresses, state, timestamps and a bytes32 hash are stored.
contract LegacyVault {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    enum State {
        ACTIVE,     // owner is alive and checking in
        GRACE,      // check-in missed, owner still has time to respond
        CONFIRMED,  // 2 of 3 trusted contacts confirmed
        RELEASED    // release delay passed, vault is released
    }

    /// @notice Everything the UI needs in a single call.
    struct Status {
        address owner;
        address keeper;
        State state;
        uint256 checkInPeriod;
        uint256 gracePeriod;
        uint256 releaseDelay;
        uint256 lastCheckIn;
        uint256 checkInDeadline;
        uint256 graceDeadline;
        uint256 confirmedAt;
        uint256 releaseAvailableAt; // 0 unless CONFIRMED/RELEASED
        address[3] trustedContacts;
        uint256 confirmationCount;
        address[] beneficiaries;
        bytes32 vaultHash;
        bool demoMode;
        uint256 round;
    }

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    uint256 public constant REQUIRED_CONFIRMATIONS = 2;
    uint256 public constant MAX_BENEFICIARIES = 10;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    address public immutable owner;
    address public immutable keeper;
    bool public immutable demoMode;

    uint256 public immutable checkInPeriod;
    uint256 public immutable gracePeriod;
    uint256 public immutable releaseDelay;

    State public state;
    uint256 public lastCheckIn;
    uint256 public checkInDeadline;
    uint256 public graceDeadline;
    uint256 public confirmedAt;

    address[3] public trustedContacts;
    bool public contactsSet;

    /// @notice round => contact => confirmed?
    /// Bumping `round` on every reset makes old confirmations meaningless.
    mapping(uint256 => mapping(address => bool)) public hasConfirmed;
    uint256 public confirmationCount;
    uint256 public round;

    address[] private beneficiaries;
    bytes32 public vaultHash;

    // ------------------------------------------------------------------
    // Events (all include a timestamp)
    // ------------------------------------------------------------------

    event CheckIn(address indexed owner, uint256 timestamp, uint256 nextDeadline);
    event BeneficiariesUpdated(address[] beneficiaries, uint256 timestamp);
    event TrustedContactsUpdated(address[3] contacts, uint256 timestamp);
    event GraceStarted(address indexed caller, uint256 graceDeadline, uint256 timestamp);
    event TrustedContactConfirmed(address indexed contact, uint256 count, uint256 round, uint256 timestamp);
    event DeathConfirmed(uint256 releaseAvailableAt, uint256 timestamp);
    event VaultReleased(address indexed caller, uint256 timestamp);
    event VaultCancelled(address indexed by, string reason, uint256 newRound, uint256 timestamp);
    event VaultHashStored(address indexed by, bytes32 vaultHash, uint256 timestamp);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error NotOwner();
    error NotKeeperOrOwner();
    error NotTrustedContact();
    error ZeroAddress();
    error ZeroPeriod();
    error InvalidState(State current);
    error DeadlineNotPassed();
    error GraceNotOver();
    error ReleaseDelayNotPassed();
    error ContactsNotSet();
    error AlreadyConfirmed();
    error DuplicateContact();
    error OwnerCannotBeContact();
    error EmptyBeneficiaries();
    error TooManyBeneficiaries();
    error ZeroHash();
    error NotDemoMode();

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(
        address _keeper,
        uint256 _checkInPeriod,
        uint256 _gracePeriod,
        uint256 _releaseDelay,
        bool _demoMode
    ) {
        if (_keeper == address(0)) revert ZeroAddress();
        if (_checkInPeriod == 0 || _gracePeriod == 0 || _releaseDelay == 0) revert ZeroPeriod();

        owner = msg.sender;
        keeper = _keeper;
        checkInPeriod = _checkInPeriod;
        gracePeriod = _gracePeriod;
        releaseDelay = _releaseDelay;
        demoMode = _demoMode;

        state = State.ACTIVE;
        lastCheckIn = block.timestamp;
        checkInDeadline = block.timestamp + _checkInPeriod;
    }

    // ------------------------------------------------------------------
    // Owner actions
    // ------------------------------------------------------------------

    /// @notice "I'm still here". Works in ACTIVE, GRACE and CONFIRMED.
    ///         In GRACE/CONFIRMED it also cancels the pending release.
    function checkIn() external onlyOwner {
        if (state == State.RELEASED) revert InvalidState(state);

        bool wasPending = (state == State.GRACE || state == State.CONFIRMED);

        _refreshDeadline();
        if (wasPending) {
            _resetToActive("owner check-in");
        }

        emit CheckIn(owner, block.timestamp, checkInDeadline);
    }

    /// @notice Owner cancels a pending release (GRACE or CONFIRMED).
    ///         Cancelling proves the owner is alive, so the deadline is refreshed too
    ///         (otherwise the old, already-passed deadline would re-trigger grace at once).
    function cancel() external onlyOwner {
        if (state != State.GRACE && state != State.CONFIRMED) revert InvalidState(state);

        _refreshDeadline();
        _resetToActive("owner cancelled");
    }

    /// @notice Replace the beneficiary list (1..10 non-zero addresses).
    function setBeneficiaries(address[] calldata _beneficiaries) external onlyOwner {
        if (state == State.RELEASED) revert InvalidState(state);
        uint256 len = _beneficiaries.length;
        if (len == 0) revert EmptyBeneficiaries();
        if (len > MAX_BENEFICIARIES) revert TooManyBeneficiaries();

        delete beneficiaries;
        for (uint256 i = 0; i < len; i++) {
            if (_beneficiaries[i] == address(0)) revert ZeroAddress();
            beneficiaries.push(_beneficiaries[i]);
        }

        emit BeneficiariesUpdated(_beneficiaries, block.timestamp);
    }

    /// @notice Set exactly 3 trusted contacts. Only while ACTIVE, so contacts
    ///         can't be swapped in the middle of a grace/confirmation process.
    function setTrustedContacts(address[3] calldata _contacts) external onlyOwner {
        if (state != State.ACTIVE) revert InvalidState(state);

        for (uint256 i = 0; i < 3; i++) {
            if (_contacts[i] == address(0)) revert ZeroAddress();
            if (_contacts[i] == owner) revert OwnerCannotBeContact();
            for (uint256 j = i + 1; j < 3; j++) {
                if (_contacts[i] == _contacts[j]) revert DuplicateContact();
            }
        }

        trustedContacts = _contacts;
        contactsSet = true;

        emit TrustedContactsUpdated(_contacts, block.timestamp);
    }

    /// @notice Store the hash of the encrypted off-chain vault. Owner or keeper.
    function storeVaultHash(bytes32 _hash) external {
        if (msg.sender != owner && msg.sender != keeper) revert NotKeeperOrOwner();
        if (_hash == bytes32(0)) revert ZeroHash();
        if (state == State.RELEASED) revert InvalidState(state);

        vaultHash = _hash;

        emit VaultHashStored(msg.sender, _hash, block.timestamp);
    }

    /// @notice Demo only: go from RELEASED back to ACTIVE without redeploying.
    function resetDemo() external onlyOwner {
        if (!demoMode) revert NotDemoMode();
        if (state != State.RELEASED) revert InvalidState(state);

        _refreshDeadline();
        _resetToActive("demo reset");
    }

    // ------------------------------------------------------------------
    // Permissionless, condition-gated actions (called by the keeper agent)
    // ------------------------------------------------------------------

    /// @notice Anyone can start grace once the check-in deadline has passed.
    function startGrace() external {
        if (state != State.ACTIVE) revert InvalidState(state);
        if (block.timestamp <= checkInDeadline) revert DeadlineNotPassed();
        if (!contactsSet) revert ContactsNotSet();

        state = State.GRACE;
        graceDeadline = block.timestamp + gracePeriod;

        emit GraceStarted(msg.sender, graceDeadline, block.timestamp);
    }

    /// @notice Anyone can release once CONFIRMED and the release delay has passed.
    ///         The delay is the owner's last chance to cancel if contacts collude.
    function release() external {
        if (state != State.CONFIRMED) revert InvalidState(state);
        if (block.timestamp < confirmedAt + releaseDelay) revert ReleaseDelayNotPassed();

        state = State.RELEASED;

        emit VaultReleased(msg.sender, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Trusted contact action
    // ------------------------------------------------------------------

    /// @notice A trusted contact confirms the owner's death. Only after the
    ///         full grace window, once per contact per round. 2 of 3 => CONFIRMED.
    function confirmDeath() external {
        if (!isTrustedContact(msg.sender)) revert NotTrustedContact();
        if (state != State.GRACE) revert InvalidState(state);
        if (block.timestamp <= graceDeadline) revert GraceNotOver();
        if (hasConfirmed[round][msg.sender]) revert AlreadyConfirmed();

        hasConfirmed[round][msg.sender] = true;
        confirmationCount += 1;

        emit TrustedContactConfirmed(msg.sender, confirmationCount, round, block.timestamp);

        if (confirmationCount >= REQUIRED_CONFIRMATIONS) {
            state = State.CONFIRMED;
            confirmedAt = block.timestamp;
            emit DeathConfirmed(confirmedAt + releaseDelay, block.timestamp);
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function isTrustedContact(address _addr) public view returns (bool) {
        if (!contactsSet) return false;
        return _addr == trustedContacts[0] || _addr == trustedContacts[1] || _addr == trustedContacts[2];
    }

    /// @notice Has `_contact` confirmed in the current round?
    function hasConfirmedThisRound(address _contact) external view returns (bool) {
        return hasConfirmed[round][_contact];
    }

    function getBeneficiaries() external view returns (address[] memory) {
        return beneficiaries;
    }

    /// @notice One RPC call with everything the keeper and UI need.
    function getStatus() external view returns (Status memory s) {
        s.owner = owner;
        s.keeper = keeper;
        s.state = state;
        s.checkInPeriod = checkInPeriod;
        s.gracePeriod = gracePeriod;
        s.releaseDelay = releaseDelay;
        s.lastCheckIn = lastCheckIn;
        s.checkInDeadline = checkInDeadline;
        s.graceDeadline = graceDeadline;
        s.confirmedAt = confirmedAt;
        s.releaseAvailableAt = confirmedAt == 0 ? 0 : confirmedAt + releaseDelay;
        s.trustedContacts = trustedContacts;
        s.confirmationCount = confirmationCount;
        s.beneficiaries = beneficiaries;
        s.vaultHash = vaultHash;
        s.demoMode = demoMode;
        s.round = round;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// @dev Owner proved they are alive: restart the check-in clock.
    function _refreshDeadline() private {
        lastCheckIn = block.timestamp;
        checkInDeadline = block.timestamp + checkInPeriod;
    }

    /// @dev Back to ACTIVE with a fresh round (old confirmations no longer count).
    function _resetToActive(string memory reason) private {
        state = State.ACTIVE;
        round += 1;
        confirmationCount = 0;
        graceDeadline = 0;
        confirmedAt = 0;

        emit VaultCancelled(msg.sender, reason, round, block.timestamp);
    }
}
