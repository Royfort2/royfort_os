if (!customElements.get('lookbook-icon')) {
  customElements.define(
    'lookbook-icon',
    class LookbookIcon extends HTMLElement {
      constructor() {
        super();

        this.selectors = {
          cardContainer: '.lookbook-card',
          cardProduct: '.lookbook-card__product',
        };

        this.cardContainer = this.closest(this.selectors.cardContainer);
        this.cardProduct = this.querySelector(this.selectors.cardProduct);

        this.init();
        this.addEventListener('mouseover', this.init.bind(this));
      }

      disconnectedCallback() {
        this.removeEventListener('mouseover', this.init.bind(this));
      }

      init() {
        if (this.cardProduct) {
          this.cardContainerOffsetX = this.cardContainer.getBoundingClientRect().left;
          this.cardContainerOffsetY = this.cardContainer.getBoundingClientRect().top;

          this.offsetX = this.getBoundingClientRect().left - this.cardContainerOffsetX;
          this.offsetY = this.getBoundingClientRect().top - this.cardContainerOffsetY;

          this.cardProductWidth = this.cardProduct.clientWidth;
          this.cardProductHeight = this.cardProduct.clientHeight;
          this.cardContainerWidth = this.cardContainer.clientWidth;

          if (this.offsetX > this.cardProductWidth) {
            this.cardProduct.style.left = 'auto';
            if (this.cardContainerWidth - this.offsetY < 15) {
              this.cardProduct.style.right = 'calc(-100% + 2rem)';
            } else {
              this.cardProduct.style.right = '-100%';
            }
          } else {
            this.cardProduct.style.right = 'auto';
            if (this.cardContainerWidth - this.offsetX > this.cardProductWidth) {
              if (this.offsetX < 15) {
                this.cardProduct.style.left = 'calc(-100% + 2rem)';
              } else {
                this.cardProduct.style.left = '-100%';
              }
            } else {
              this.cardProduct.style.left = this.cardContainerWidth - this.cardProductWidth - this.offsetX + 'px';
            }
          }

          if (this.offsetY > this.cardProductHeight) {
            this.cardProduct.style.top = 'auto';
            this.cardProduct.style.bottom = '100%';
          } else {
            this.cardProduct.style.bottom = 'auto';
            this.cardProduct.style.top = '100%';
          }
        }
      }
    }
  );
}
