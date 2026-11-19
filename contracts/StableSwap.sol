// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Exact-transfer ERC20 HTLC. Fee-on-transfer and rebasing tokens are unsupported.
contract StableSwap {
    struct Lock { address token; address sender; address receiver; uint256 amount; uint256 expiry; }
    mapping(bytes32 => Lock) public locks;
    mapping(bytes32 => bool) public used;
    uint256 private entered;
    event Locked(bytes32 indexed id, bytes32 indexed hashlock, address token, address sender, address receiver, uint256 amount, uint256 expiry);
    event Claimed(bytes32 indexed id, bytes32 secret);
    event Refunded(bytes32 indexed id);
    modifier guard() { require(entered == 0, "reentrant"); entered = 1; _; entered = 0; }

    function lock(address token, address receiver, uint256 amount, bytes32 hashlock, uint256 expiry, bytes32 salt) external guard returns (bytes32 id) {
        require(token.code.length > 0 && receiver != address(0) && receiver != msg.sender && amount > 0, "invalid parties");
        require(expiry > block.timestamp + 600 && expiry < block.timestamp + 7 days, "expiry");
        id = keccak256(abi.encode(block.chainid, address(this), msg.sender, receiver, token, amount, hashlock, expiry, salt));
        require(!used[id], "duplicate");
        used[id] = true;
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
        require(IERC20(token).balanceOf(address(this)) == beforeBalance + amount, "unsupported token");
        locks[id] = Lock(token,msg.sender,receiver,amount,expiry);
        emit Locked(id,hashlock,token,msg.sender,receiver,amount,expiry);
        // Bind the preimage hash to the lock ID without relying on caller-supplied claim data.
        hashes[id] = hashlock;
    }
    mapping(bytes32 => bytes32) public hashes;
    function claim(bytes32 id, bytes32 secret) external guard {
        Lock memory item = locks[id];
        require(item.sender != address(0) && msg.sender == item.receiver && block.timestamp < item.expiry, "unavailable");
        require(sha256(abi.encodePacked(secret)) == hashes[id], "secret");
        delete locks[id]; delete hashes[id];
        require(IERC20(item.token).transfer(item.receiver,item.amount), "transfer");
        emit Claimed(id,secret);
    }
    function refund(bytes32 id) external guard {
        Lock memory item = locks[id];
        require(item.sender != address(0) && msg.sender == item.sender && block.timestamp >= item.expiry, "unavailable");
        delete locks[id]; delete hashes[id];
        require(IERC20(item.token).transfer(item.sender,item.amount), "transfer");
        emit Refunded(id);
    }
}
