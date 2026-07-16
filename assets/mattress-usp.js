(function () {
    let currentIndex = 0;
    let matrixIndex = [0, 1];

    let screenWidth = 0;
    if (window.innerWidth < 768) {
        screenWidth = window.innerWidth;
    }

    const pointers = document.querySelectorAll(".MattressUSP__pointers");
    const blocks = document.querySelectorAll(".MattressUSP--block");
    const blocksParent = document.querySelector(".MattressUSP__blocks");
    const imageElement = document.querySelector(".MattressUSP__image");
    const uspArrows = document.querySelectorAll(".MattressUSP__arrow");

    blocksParent.style.width = "" + screenWidth * 3 + "px";
    let currentPointer = document.querySelector(".MattressUSP__pointers.active")
    let currentBlock = document.querySelector(".MattressUSP--block.active");


    function index_change(pointer, block, index) {
        currentPointer.classList.remove("active");
        pointer.classList.add("active");
        currentPointer = pointer;

        currentBlock.classList.remove("active");
        block.classList.add("active");
        currentBlock = block;

        if (index === 0) {
            blocksParent.style.transform = "translateX(0)";
            imageElement.style.transform = "translateX(30%)"
            matrixIndex = [0, 1]
        } else if (index === 1) {
            blocksParent.style.transform = "translateX(-33.333%)";
            imageElement.style.transform = "translateX(0)"
            matrixIndex = [0, 2]
        } else {
            blocksParent.style.transform = "translateX(-66.666%)";
            imageElement.style.transform = "translateX(-30%)"
            matrixIndex = [1, 2]
        }
    }

    pointers.forEach((element, index) => {
        element.addEventListener("click", () => {
            index_change(element, blocks[index], index)
        })
    })

    let touchstartX = 0
    let touchendX = 0

    function checkDirection() {
        let minimalRequiredSwipe = Math.abs(touchstartX - touchendX) > 26;

        if (touchendX < touchstartX && minimalRequiredSwipe) {
            index_change(pointers[matrixIndex[1]], blocks[matrixIndex[1]], matrixIndex[1])
        }
        if (touchendX > touchstartX && minimalRequiredSwipe) {
            index_change(pointers[matrixIndex[0]], blocks[matrixIndex[0]], matrixIndex[0])
        }
    }

    document.querySelector(".MattressUSP").addEventListener('touchstart', (e) => {
        touchstartX = e.changedTouches[0].screenX
    })

    document.querySelector(".MattressUSP").addEventListener('touchend', (e) => {
        touchendX = e.changedTouches[0].screenX
        checkDirection()
    })

    uspArrows.forEach((element) => {
        element.addEventListener("click", () => {
            if (element.classList.contains("left")) {
                index_change(pointers[matrixIndex[0]], blocks[matrixIndex[0]], matrixIndex[0])
            } else if (element.classList.contains("right")) {
                index_change(pointers[matrixIndex[1]], blocks[matrixIndex[1]], matrixIndex[1])
            }
        })
    })
}())