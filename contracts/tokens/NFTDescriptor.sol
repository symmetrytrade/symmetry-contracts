// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "../interfaces/INFTDescriptor.sol";

/* solhint-disable quotes */
contract NFTDescriptor is INFTDescriptor {
    string private constant LOGO =
        '<path fill-rule="evenodd" clip-rule="evenodd" d="M209.527 473.257C210.069 469.47 207.546 466.4 203.891 466.4H198.377C194.723 466.4 191.321 469.47 190.779 473.257L190.288 476.686H183.672C180.017 476.686 176.615 479.756 176.073 483.543C175.531 487.33 178.054 490.4 181.709 490.4H188.325L188.328 490.38H193.842L193.839 490.4H200.456C204.111 490.4 207.512 487.33 208.055 483.543C208.348 481.495 207.744 479.657 206.551 478.4C208.104 477.144 209.234 475.305 209.527 473.257ZM200.092 469.829C198.265 469.829 196.564 471.364 196.293 473.257L195.802 476.686H200.214C202.041 476.686 203.742 475.151 204.013 473.257C204.284 471.364 203.022 469.829 201.195 469.829H200.092ZM181.587 483.543C181.858 481.649 183.559 480.114 185.386 480.114H186.489C188.316 480.114 189.578 481.649 189.307 483.543C189.036 485.436 187.335 486.971 185.508 486.971H184.405C182.578 486.971 181.316 485.436 181.587 483.543ZM194.821 483.543C195.092 481.649 196.793 480.114 198.62 480.114H199.723C201.55 480.114 202.812 481.649 202.541 483.543C202.27 485.436 200.569 486.971 198.741 486.971H197.639C195.811 486.971 194.55 485.436 194.821 483.543Z" /><path fill-rule="evenodd" clip-rule="evenodd" d="M235.414 488.355V469.6H237.259V488.355H235.414ZM225.369 488.62C224.192 488.62 223.137 488.337 222.206 487.772C221.274 487.189 220.536 486.412 219.991 485.441C219.464 484.47 219.2 483.375 219.2 482.156C219.2 480.92 219.464 479.816 219.991 478.845C220.536 477.856 221.274 477.079 222.206 476.514C223.137 475.931 224.183 475.64 225.343 475.64C226.292 475.64 227.136 475.834 227.874 476.223C228.63 476.593 229.236 477.123 229.693 477.812C229.739 477.877 229.783 477.942 229.825 478.009V475.905H231.671V488.355H229.825V486.246C229.783 486.314 229.739 486.381 229.693 486.448C229.236 487.136 228.63 487.675 227.874 488.064C227.136 488.434 226.301 488.62 225.369 488.62ZM225.659 486.845C226.943 486.845 227.971 486.412 228.744 485.547C229.535 484.682 229.931 483.543 229.931 482.13C229.931 481.194 229.746 480.373 229.377 479.666C229.025 478.942 228.525 478.386 227.874 477.997C227.241 477.591 226.494 477.388 225.633 477.388C224.754 477.388 223.972 477.591 223.287 477.997C222.619 478.404 222.083 478.969 221.678 479.693C221.292 480.399 221.098 481.212 221.098 482.13C221.098 483.048 221.292 483.861 221.678 484.567C222.083 485.273 222.627 485.83 223.313 486.236C223.998 486.642 224.781 486.845 225.659 486.845ZM244.85 488.037C245.606 488.426 246.459 488.62 247.408 488.62C248.55 488.62 249.579 488.337 250.493 487.772C251.424 487.189 252.154 486.412 252.681 485.441C253.208 484.47 253.472 483.375 253.472 482.156C253.472 480.92 253.199 479.816 252.654 478.845C252.127 477.856 251.407 477.079 250.493 476.514C249.579 475.931 248.55 475.64 247.408 475.64C246.494 475.64 245.65 475.825 244.877 476.196C244.121 476.567 243.497 477.097 243.005 477.785C242.95 477.861 242.897 477.937 242.847 478.016V475.905H241.001V493.6H242.847V486.246C242.889 486.314 242.933 486.381 242.978 486.448C243.47 487.119 244.094 487.649 244.85 488.037ZM249.412 486.262C248.744 486.651 247.97 486.845 247.091 486.845C246.23 486.845 245.474 486.651 244.824 486.262C244.174 485.856 243.664 485.3 243.295 484.593C242.926 483.869 242.741 483.048 242.741 482.13C242.741 481.194 242.926 480.373 243.295 479.666C243.664 478.96 244.174 478.404 244.824 477.997C245.492 477.591 246.256 477.388 247.118 477.388C247.979 477.388 248.744 477.591 249.412 477.997C250.079 478.404 250.598 478.96 250.967 479.666C251.354 480.373 251.547 481.194 251.547 482.13C251.547 483.048 251.354 483.869 250.967 484.593C250.598 485.3 250.079 485.856 249.412 486.262ZM265.441 488.355V481.044C265.441 479.949 265.116 479.066 264.465 478.395C263.832 477.706 262.989 477.362 261.934 477.362C261.213 477.362 260.581 477.521 260.036 477.838C259.491 478.156 259.06 478.589 258.744 479.136C258.427 479.684 258.269 480.311 258.269 481.017V488.355H256.424V469.6H258.269V477.734C258.685 477.129 259.212 476.643 259.851 476.276C260.607 475.852 261.468 475.64 262.435 475.64C263.384 475.64 264.228 475.861 264.966 476.302C265.704 476.726 266.276 477.317 266.68 478.077C267.102 478.836 267.313 479.719 267.313 480.726V488.355H265.441ZM272.98 487.772C273.911 488.337 274.966 488.62 276.144 488.62C277.075 488.62 277.91 488.434 278.648 488.064C279.404 487.675 280.011 487.136 280.468 486.448C280.513 486.381 280.557 486.314 280.599 486.246V488.355H282.445V475.905H280.599V478.009C280.564 477.953 280.528 477.899 280.491 477.845C280.483 477.834 280.475 477.823 280.468 477.812C280.011 477.123 279.404 476.593 278.648 476.223C277.91 475.834 277.066 475.64 276.117 475.64C274.957 475.64 273.911 475.931 272.98 476.514C272.048 477.079 271.31 477.856 270.765 478.845C270.238 479.816 269.974 480.92 269.974 482.156C269.974 483.375 270.238 484.47 270.765 485.441C271.31 486.412 272.048 487.189 272.98 487.772ZM279.518 485.547C278.745 486.412 277.717 486.845 276.434 486.845C275.555 486.845 274.773 486.642 274.087 486.236C273.402 485.83 272.857 485.273 272.452 484.567C272.066 483.861 271.872 483.048 271.872 482.13C271.872 481.212 272.066 480.399 272.452 479.693C272.857 478.969 273.393 478.404 274.061 477.997C274.746 477.591 275.528 477.388 276.407 477.388C277.269 477.388 278.016 477.591 278.648 477.997C279.299 478.386 279.8 478.942 280.151 479.666C280.52 480.373 280.705 481.194 280.705 482.13C280.705 483.543 280.309 484.682 279.518 485.547ZM292.595 488.62C291.646 488.62 290.793 488.426 290.037 488.037C289.281 487.649 288.657 487.119 288.165 486.448C288.154 486.431 288.143 486.415 288.132 486.398C288.122 486.384 288.113 486.37 288.103 486.355C288.079 486.319 288.056 486.283 288.033 486.246V488.355H286.188V469.6H288.033V478.016C288.056 477.98 288.08 477.945 288.103 477.91C288.132 477.868 288.162 477.827 288.192 477.785C288.684 477.097 289.308 476.567 290.064 476.196C290.837 475.825 291.681 475.64 292.595 475.64C293.737 475.64 294.765 475.931 295.679 476.514C296.593 477.079 297.314 477.856 297.841 478.845C298.386 479.816 298.659 480.92 298.659 482.156C298.659 483.375 298.395 484.47 297.868 485.441C297.34 486.412 296.611 487.189 295.679 487.772C294.765 488.337 293.737 488.62 292.595 488.62ZM292.278 486.845C293.157 486.845 293.931 486.651 294.598 486.262C295.266 485.856 295.785 485.3 296.154 484.593C296.541 483.869 296.734 483.048 296.734 482.13C296.734 481.194 296.541 480.373 296.154 479.666C295.785 478.96 295.266 478.404 294.598 477.997C293.931 477.591 293.166 477.388 292.305 477.388C291.443 477.388 290.679 477.591 290.011 477.997C289.361 478.404 288.851 478.96 288.482 479.666C288.113 480.373 287.928 481.194 287.928 482.13C287.928 483.048 288.113 483.869 288.482 484.593C288.851 485.3 289.361 485.856 290.011 486.262C290.661 486.651 291.417 486.845 292.278 486.845ZM303.984 487.772C304.968 488.337 306.084 488.62 307.332 488.62C308.316 488.62 309.23 488.434 310.074 488.064C310.935 487.675 311.656 487.136 312.236 486.448L311.05 485.229C310.61 485.777 310.074 486.192 309.441 486.474C308.808 486.739 308.114 486.872 307.358 486.872C306.427 486.872 305.601 486.668 304.88 486.262C304.177 485.856 303.623 485.291 303.219 484.567C302.94 484.044 302.761 483.461 302.684 482.819H312.842C312.895 482.571 312.93 482.359 312.948 482.183C312.965 481.989 312.974 481.821 312.974 481.68C312.974 480.496 312.719 479.454 312.21 478.554C311.717 477.635 311.032 476.92 310.153 476.408C309.292 475.896 308.299 475.64 307.174 475.64C305.979 475.64 304.898 475.922 303.931 476.487C302.964 477.053 302.2 477.83 301.637 478.819C301.075 479.79 300.793 480.885 300.793 482.103C300.793 483.34 301.075 484.452 301.637 485.441C302.217 486.43 302.999 487.207 303.984 487.772ZM302.689 481.229C302.766 480.617 302.934 480.069 303.193 479.587C303.579 478.88 304.107 478.333 304.775 477.944C305.442 477.556 306.225 477.362 307.121 477.362C307.982 477.362 308.712 477.547 309.309 477.918C309.925 478.271 310.39 478.783 310.707 479.454C310.968 479.965 311.121 480.557 311.168 481.229H302.689ZM317.259 488.355V477.574H314.121V475.905H317.259V470.66H319.104V475.905H322.216V477.574H319.104V488.355H317.259ZM326.535 487.772C327.466 488.337 328.521 488.62 329.699 488.62C330.63 488.62 331.465 488.434 332.203 488.064C332.959 487.675 333.566 487.136 334.023 486.448C334.068 486.381 334.112 486.314 334.154 486.246V488.355H336V475.905H334.154V478.009C334.112 477.942 334.068 477.877 334.023 477.812C333.566 477.123 332.959 476.593 332.203 476.223C331.465 475.834 330.621 475.64 329.672 475.64C328.512 475.64 327.466 475.931 326.535 476.514C325.603 477.079 324.865 477.856 324.32 478.845C323.793 479.816 323.529 480.92 323.529 482.156C323.529 483.375 323.793 484.47 324.32 485.441C324.865 486.412 325.603 487.189 326.535 487.772ZM333.073 485.547C332.3 486.412 331.272 486.845 329.989 486.845C329.11 486.845 328.328 486.642 327.642 486.236C326.957 485.83 326.412 485.273 326.007 484.567C325.621 483.861 325.427 483.048 325.427 482.13C325.427 481.212 325.621 480.399 326.007 479.693C326.412 478.969 326.948 478.404 327.616 477.997C328.301 477.591 329.083 477.388 329.962 477.388C330.824 477.388 331.571 477.591 332.203 477.997C332.854 478.386 333.355 478.942 333.706 479.666C334.075 480.373 334.26 481.194 334.26 482.13C334.26 483.543 333.864 484.682 333.073 485.547Z" />';

    bytes32 private constant SYMBOL_DOMAIN = "SYMBOL";

    bytes32 private constant BACKGROUND_DOMAIN = "BACKGROUND";

    bytes32 private constant RARE_DOMAIN = "RARE";

    uint private constant UNIT = 1e18;

    function _generateName(TokenURIParams memory _params) internal pure returns (string memory) {
        return string.concat("Symmetry Trading Coupon - $", Strings.toString(_params.value / UNIT));
    }

    function _generateDescription() internal pure returns (string memory) {
        return
            "This NFT represents a trading coupon from Symmetry. The owner of this NFT can apply the coupon with its face value on symmetry.trade and use the value to pay for trading fees. A greek alphabet is randomly assigned to each trading coupon. Try to collect all 24 if you are a collector! There's also a small chance that you can get a rare-looking one. Keep an eye!";
    }

    function _rectColor(uint _salt) internal pure returns (string memory) {
        _salt = _salt % 8;
        if (_salt == 0) {
            return "#FF5A86";
        } else if (_salt == 1) {
            return "#57AAF8";
        } else if (_salt == 2) {
            return "#855CDC";
        } else if (_salt == 3) {
            return "#08C605";
        } else if (_salt == 4) {
            return "#46E1A8";
        } else if (_salt == 5) {
            return "#FFBFCF";
        } else if (_salt == 6) {
            return "#FFEE52";
        } else {
            return "#D4C6FD";
        }
    }

    function _textColor(uint _salt) internal pure returns (string memory) {
        _salt = uint(keccak256(abi.encodePacked(_salt, BACKGROUND_DOMAIN)));
        return _salt % 8 < 4 ? "white" : "black";
    }

    function _isRare(uint _salt) internal pure returns (bool) {
        _salt = uint(keccak256(abi.encodePacked(_salt, RARE_DOMAIN)));
        return _salt % 20 == 0; // 5%
    }

    function _generateBackground(uint _salt) internal pure returns (string memory) {
        _salt = uint(keccak256(abi.encodePacked(_salt, BACKGROUND_DOMAIN)));
        return string.concat('<rect width="512" height="512" fill="', _rectColor(_salt), '" />');
    }

    function _rareColor(uint _seed) internal pure returns (string memory) {
        _seed = _seed % 56; // 8 * 7
        string memory color1 = _rectColor(_seed / 7); // 0-7
        string memory color2 = _rectColor(_seed / 7 > _seed % 7 ? _seed % 7 : (_seed % 7) + 1); // different from color1
        return string.concat(color1, ";", color2, ";", color1, ";");
    }

    function _rareComponent(
        uint _salt,
        uint _x,
        uint _y,
        string memory _suffix
    ) internal pure returns (string memory image) {
        image = string.concat('<path d="M', Strings.toString(_x), " ", Strings.toString(_y), _suffix, '">');
        image = string.concat(
            image,
            '<animate attributeName="fill" values="',
            _rareColor(uint(keccak256(abi.encodePacked(_salt, _x, _y, _suffix)))),
            '" dur="2s" repeatCount="indefinite" />'
        );
        image = string.concat(image, "</path>");
    }

    function _generateRare(uint _salt) internal pure returns (string memory image) {
        image = '<g opacity="0.3" transform="translate(-104 -104) scale(20)">';
        // pattern 1
        for (uint y = 0; y <= 27; y += 9) {
            for (uint x = (((y / 9) % 2) + 1) * 9; x <= 36; x += 18) {
                image = string.concat(image, _rareComponent(_salt, x, y, "h-9v9Z"));
                image = string.concat(image, _rareComponent(_salt, x, y, "v9h-9Z"));
                image = string.concat(image, _rareComponent(_salt, x, y, "c0 5 -4 9 -9 9c0 -5 4 -9 9 -9"));
            }
        }
        // pattern 2
        for (uint y = 0; y <= 27; y += 9) {
            for (uint x = ((y / 9 + 1) % 2) * 9; x < 36; x += 18) {
                image = string.concat(image, _rareComponent(_salt, x, y, "h9v9Z"));
                image = string.concat(image, _rareComponent(_salt, x, y, "v9h9Z"));
                image = string.concat(image, _rareComponent(_salt, x, y, "c0 5 4 9 9 9c0 -5 -4 -9 -9 -9"));
            }
        }
        image = string.concat(image, "</g>");
    }

    function _generateValue(uint _value) internal pure returns (string memory) {
        return
            string.concat(
                ' <text x="50%" y="24" text-anchor="middle" alignment-baseline="hanging" font-family="Verdana" font-size="64">$',
                Strings.toString(_value / UNIT),
                "</text>"
            );
    }

    function _generateSymbol(uint _salt) internal pure returns (string memory image) {
        _salt = uint(keccak256(abi.encodePacked(_salt, SYMBOL_DOMAIN))) % 24;
        string memory greek;
        string memory greekName;
        uint y;
        if (_salt == 0) {
            greek = unicode"α";
            greekName = "alpha";
            y = 360;
        } else if (_salt == 1) {
            greek = unicode"β";
            greekName = "beta";
            y = 400;
        } else if (_salt == 2) {
            greek = unicode"γ";
            greekName = "gamma";
            y = 400;
        } else if (_salt == 3) {
            greek = unicode"δ";
            greekName = "delta";
            y = 360;
        } else if (_salt == 4) {
            greek = unicode"ε";
            greekName = "epsilon";
            y = 360;
        } else if (_salt == 5) {
            greek = unicode"ζ";
            greekName = "zeta";
            y = 400;
        } else if (_salt == 6) {
            greek = unicode"η";
            greekName = "eta";
            y = 400;
        } else if (_salt == 7) {
            greek = unicode"θ";
            greekName = "theta";
            y = 360;
        } else if (_salt == 8) {
            greek = unicode"ι";
            greekName = "iota";
            y = 360;
        } else if (_salt == 9) {
            greek = unicode"κ";
            greekName = "kappa";
            y = 360;
        } else if (_salt == 10) {
            greek = unicode"λ";
            greekName = "lambda";
            y = 360;
        } else if (_salt == 11) {
            greek = unicode"μ";
            greekName = "mu";
            y = 400;
        } else if (_salt == 12) {
            greek = unicode"ν";
            greekName = "nu";
            y = 360;
        } else if (_salt == 13) {
            greek = unicode"ξ";
            greekName = "xi";
            y = 400;
        } else if (_salt == 14) {
            greek = unicode"ο";
            greekName = "omicron";
            y = 360;
        } else if (_salt == 15) {
            greek = unicode"π";
            greekName = "pi";
            y = 360;
        } else if (_salt == 16) {
            greek = unicode"ρ";
            greekName = "rho";
            y = 400;
        } else if (_salt == 17) {
            greek = unicode"σ";
            greekName = "sigma";
            y = 360;
        } else if (_salt == 18) {
            greek = unicode"τ";
            greekName = "tau";
            y = 360;
        } else if (_salt == 19) {
            greek = unicode"υ";
            greekName = "upsilon";
            y = 360;
        } else if (_salt == 20) {
            greek = unicode"φ";
            greekName = "phi";
            y = 400;
        } else if (_salt == 21) {
            greek = unicode"χ";
            greekName = "chi";
            y = 400;
        } else if (_salt == 22) {
            greek = unicode"ψ";
            greekName = "psi";
            y = 400;
        } else {
            greek = unicode"ω";
            greekName = "omega";
            y = 360;
        }
        image = string.concat('<text x="50%" y="300" text-anchor="middle" font-size="210">', greek, "</text>");
        image = string.concat(
            image,
            '<text x="50%" y="',
            Strings.toString(y),
            '" text-anchor="middle" font-size="36" font-family="Trebuchet MS" font-style="italic" text-decoration="underline">',
            greekName,
            "</text>"
        );
    }

    function _generateBody(TokenURIParams memory _params) internal pure returns (string memory image) {
        image = string.concat(
            '<g fill="',
            _textColor(_params.tokenSalt),
            '" font-family="Arial, sans-serif" letter-spacing="0em" font-weight="bold">'
        );
        image = string.concat(image, LOGO, _generateValue(_params.value), _generateSymbol(_params.tokenSalt));
        image = string.concat(image, "</g>");
    }

    function _generateSVGImage(TokenURIParams memory _params) internal pure returns (string memory image) {
        image = '<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">';
        image = string.concat(image, _generateBackground(_params.tokenSalt));
        if (_isRare(_params.tokenSalt)) {
            image = string.concat(image, _generateRare(_params.tokenSalt));
        }
        image = string.concat(image, _generateBody(_params));
        image = string.concat(image, "</svg>");
    }

    function constructTokenURI(TokenURIParams memory _params) public pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(
                            abi.encodePacked(
                                '{"name":"',
                                _generateName(_params),
                                '", "description":"',
                                _generateDescription(),
                                '", "image": "',
                                "data:image/svg+xml;base64,",
                                Base64.encode(bytes(_generateSVGImage(_params))),
                                '"}'
                            )
                        )
                    )
                )
            );
    }
}
