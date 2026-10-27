// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ResumeRegistry
/// @notice Anchors SHA-256 resume fingerprints without publishing resume contents.
contract ResumeRegistry {
    struct Record {
        address owner;
        uint64 timestamp;
    }

    mapping(bytes32 => Record) public records;

    event ResumeRegistered(bytes32 indexed resumeHash, address indexed owner, uint64 timestamp);

    function registerResume(bytes32 resumeHash) external {
        require(resumeHash != bytes32(0), "Empty fingerprint");
        require(records[resumeHash].timestamp == 0, "Already registered");
        uint64 registeredAt = uint64(block.timestamp);
        records[resumeHash] = Record(msg.sender, registeredAt);
        emit ResumeRegistered(resumeHash, msg.sender, registeredAt);
    }
}
