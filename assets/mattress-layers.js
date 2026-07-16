(function () {
    let toggledElement;
    let toggledImage;
    let toggledIndex;

    function toggleElement(element) {
        if (element.classList.contains("active")) {
            element.classList.remove("active")
            toggledElement = null;
        } else {
            if (toggledElement) {
                toggledElement.classList.remove("active")
            }
            element.classList.add("active");
            toggledElement = element;
        }
    }

    function toggleImage(element) {
        if (element.classList.contains("active")) {
            element.classList.remove("active")
            toggledImage = null;
        } else {
            if (toggledImage) {
                toggledImage.classList.remove("active")
            }
            element.classList.add("active");
            toggledImage = element;
        }
    }

    const layerBox = document.querySelectorAll(".mattressShared__layer");
    const imageBox = document.querySelectorAll(".mattressShared__layerMobile .mattressShared__imageBox");

    layerBox.forEach((element, index) => {
        element.addEventListener("click", () => {
            toggleElement(element);
            toggleImage(imageBox[index]);
        })
    })

    let toggledElementSize = 82;
    imageBox.forEach((element, index) => {
        element.addEventListener("click", () => {
            toggleImage(element);
            if (toggledElement && toggledIndex < index) {
                toggledElementSize = toggledElement.offsetHeight
            } else if (toggledIndex > index) {
                toggledElementSize = 82
            }
            let topCoordinates = layerBox[index].getBoundingClientRect().top + window.scrollY - toggledElementSize;
            toggleElement(layerBox[index]);
            toggledIndex = index;
            window.scroll({
                top: topCoordinates,
                behavior: "smooth"
            })
        })
    })
}())
